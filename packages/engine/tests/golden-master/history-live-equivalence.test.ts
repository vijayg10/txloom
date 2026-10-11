import { describe, expect, it } from "vitest";
import type { SimulationSpec } from "@txloom/spec";
import {
  ImperfectionTransformer,
  checkpointWorld,
  decodeCheckpoint,
  deriveNamedRng,
  encodeCheckpoint,
  generateMerchantPool,
  initPartitionWorld,
  mergeByDeliveredAt,
  openLiveWorld,
  simulateDay,
  type Delivered,
  type PartitionWorld,
  type WorldCheckpoint,
} from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

const DAY_MS = 86_400_000;
const PARTITIONS = 3;
const SINKS = ["primary-file", "events"];
const HISTORY_DAYS = 8;
const LIVE_DAYS = 6;

/** The reference scenario with every imperfection on both sinks, so each transformer has state
 * (a late-arrival heap, a held out-of-order delivery) at the history/live boundary. */
function spec(): SimulationSpec {
  const base = structuredClone(referenceScenarioSpec());
  base.clock.days = HISTORY_DAYS;
  base.output.sinks = [
    { type: "file", name: "primary-file", format: "csv" },
    { type: "kafka", name: "events" },
  ];
  base.imperfections = {
    duplicate_delivery: { rate: 0.1, sinks: SINKS },
    // Delays of hours, so many late deliveries are still waiting when the day ends.
    late_arrival: {
      rate: 0.2,
      delay_seconds_mean: 14_400,
      delay_seconds_stddev: 3_600,
      sinks: SINKS,
    },
    out_of_order: { rate: 0.1, sinks: SINKS },
    clock_skew: { rate: 0.05, sources: [{ source: "primary-file", offset_seconds: 60 }] },
  };
  return base;
}

interface Simulation {
  worlds: PartitionWorld[];
  transformers: Map<string, ImperfectionTransformer[]>;
  days: { events: unknown[][]; labels: unknown[][]; deliveries: Record<string, Delivered[][]> }[];
}

function startSimulation(s: SimulationSpec, seed: bigint): Simulation {
  const merchants = generateMerchantPool(s, seed);
  const worlds = Array.from({ length: PARTITIONS }, (_, p) =>
    initPartitionWorld(s, seed, p, PARTITIONS, merchants),
  );
  const transformers = new Map<string, ImperfectionTransformer[]>();
  for (const sink of SINKS) {
    transformers.set(
      sink,
      worlds.map((_, p) =>
        ImperfectionTransformer.create(
          sink,
          s.imperfections,
          deriveNamedRng(seed, `imperfections:${sink}:p${p}`),
        ),
      ),
    );
  }
  return { worlds, transformers, days: [] };
}

/** Simulates days `from…to-1` the way the history worker does, without flushing the
 * transformers at the end — the boundary state is exactly what a checkpoint must carry. */
function simulate(sim: Simulation, s: SimulationSpec, from: number, to: number): void {
  const clockStartMs = Date.parse(`${s.clock.start}T00:00:00.000Z`);
  for (let day = from; day < to; day++) {
    const dayEndMs = clockStartMs + (day + 1) * DAY_MS - 1;
    const outputs = sim.worlds.map((world) => simulateDay(world, day));
    const deliveries: Record<string, Delivered[][]> = {};
    for (const sink of SINKS) {
      deliveries[sink] = outputs.map((output, p) => {
        const transformer = sim.transformers.get(sink)![p]!;
        output.events.forEach((event, i) => transformer.push(event, output.labels[i]!));
        return transformer.drainUntil(dayEndMs);
      });
    }
    sim.days.push({
      events: outputs.map((o) => o.events),
      labels: outputs.map((o) => o.labels),
      deliveries,
    });
  }
}

function checkpointsOf(sim: Simulation): WorldCheckpoint[] {
  return sim.worlds.map((world, p) => ({
    ...checkpointWorld(world),
    transformers: Object.fromEntries(
      SINKS.map((sink) => [sink, sim.transformers.get(sink)![p]!.checkpoint()]),
    ),
  }));
}

// FR-029/SC-006: live mode is history continued. Simulating history, checkpointing, restoring and
// simulating further days yields exactly what one uninterrupted simulation does.
describe("golden master: history → live equivalence", () => {
  const s = spec();
  const seed = BigInt(s.seed);

  it("restored live days are identical to an uninterrupted simulation: truth, labels and per-sink delivered output", () => {
    const uninterrupted = startSimulation(s, seed);
    simulate(uninterrupted, s, 0, HISTORY_DAYS + LIVE_DAYS);

    const history = startSimulation(s, seed);
    simulate(history, s, 0, HISTORY_DAYS);
    // Through the codec, as a real checkpoint file would be.
    const checkpoints = checkpointsOf(history).map((checkpoint) => {
      const { bytes, sha256 } = encodeCheckpoint(checkpoint);
      return decodeCheckpoint(bytes, sha256);
    });
    // The boundary must really carry pending deliveries, or this test proves little.
    const pending = checkpoints.reduce(
      (n, c) =>
        n +
        SINKS.reduce(
          (m, sink) =>
            m + ((c.transformers[sink] as { delayHeap: unknown[] }).delayHeap.length ?? 0),
          0,
        ),
      0,
    );
    expect(pending).toBeGreaterThan(0);

    const merchants = generateMerchantPool(s, seed);
    const live = openLiveWorld(s, seed, checkpoints, merchants, SINKS);

    for (let day = HISTORY_DAYS; day < HISTORY_DAYS + LIVE_DAYS; day++) {
      const expected = uninterrupted.days[day]!;
      const got = live.advanceDay();
      expect(got.dayIndex).toBe(day);
      expect(got.partitions.map((p) => p.events)).toEqual(expected.events);
      expect(got.partitions.map((p) => p.labels)).toEqual(expected.labels);
      for (const sink of SINKS) {
        expect(got.deliveries[sink]).toEqual(mergeByDeliveredAt(expected.deliveries[sink]!));
      }
    }
  });

  it("resuming from a live day checkpoint reproduces the same day", () => {
    const history = startSimulation(s, seed);
    simulate(history, s, 0, HISTORY_DAYS);
    const merchants = generateMerchantPool(s, seed);

    const live = openLiveWorld(s, seed, checkpointsOf(history), merchants, SINKS);
    live.advanceDay();
    const day = live.advanceDay(); // the second live day
    const before = live.dayCheckpoint()!;
    expect(before.dayIndex).toBe(day.dayIndex);

    const resumed = openLiveWorld(s, seed, before.partitions, merchants, SINKS);
    expect(resumed.advanceDay()).toEqual(day);
  });

  it("skipFirstDay resumes after the deliveries a previous session already made", () => {
    const history = startSimulation(s, seed);
    simulate(history, s, 0, HISTORY_DAYS);
    const merchants = generateMerchantPool(s, seed);

    const whole = openLiveWorld(s, seed, checkpointsOf(history), merchants, SINKS);
    const first = whole.nextBatch(25);
    const rest = whole.nextBatch(25);

    const resumed = openLiveWorld(s, seed, checkpointsOf(history), merchants, SINKS, {
      skipFirstDay: 25,
    });
    expect(resumed.nextBatch(25)).toEqual(rest);
    expect(first.fromIndex).toBe(0);
    expect(rest.fromIndex).toBe(25);
  });
});
