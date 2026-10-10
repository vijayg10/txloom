import { describe, expect, it } from "vitest";
import {
  deriveNamedRng,
  generateMerchantPool,
  ImperfectionTransformer,
  initPartitionWorld,
  simulateDay,
  type Delivered,
} from "../src/index.js";
import { referenceScenarioSpec } from "./fixtures.js";

const DAY_MS = 86_400_000;

function setup() {
  const spec = referenceScenarioSpec();
  spec.imperfections.late_arrival = {
    rate: 0.2,
    delay_seconds_mean: 30 * 3600,
    delay_seconds_stddev: 3600,
    sinks: ["primary-file"],
  };
  const seed = BigInt(spec.seed);
  const world = initPartitionWorld(spec, seed, 0, 1, generateMerchantPool(spec, seed));
  const start = Date.parse(`${spec.clock.start}T00:00:00.000Z`);
  const make = (name = "primary-file") =>
    ImperfectionTransformer.create(
      name,
      spec.imperfections,
      deriveNamedRng(seed, `imperfections:${name}:p0`),
    );
  return { spec, world, start, make };
}

describe("ImperfectionTransformer state", () => {
  it("a checkpoint taken mid-stream restores to identical output", () => {
    const { spec, world, start, make } = setup();
    const t = make();
    const first: Delivered[] = [];
    let restored: ImperfectionTransformer | null = null;
    const second: Delivered[] = [];
    const days = [0, 1, 2, 3, 4, 5].map((d) => simulateDay(world, d));
    days.forEach((out, day) => {
      out.events.forEach((e, i) => t.push(e, out.labels[i]!));
      first.push(...t.drainUntil(start + (day + 1) * DAY_MS - 1));
      if (day === 2) {
        restored = ImperfectionTransformer.restore(
          "primary-file",
          spec.imperfections,
          JSON.parse(JSON.stringify(t.checkpoint())),
        );
      }
    });
    first.push(...t.flush());

    // Replay days 3-5 through the restored copy and compare what it emits from there on.
    const world2 = initPartitionWorld(
      spec,
      BigInt(spec.seed),
      0,
      1,
      generateMerchantPool(spec, BigInt(spec.seed)),
    );
    const replayDays = [0, 1, 2, 3, 4, 5].map((d) => simulateDay(world2, d));
    replayDays.forEach((out, day) => {
      if (day <= 2) return;
      out.events.forEach((e, i) => restored!.push(e, out.labels[i]!));
      second.push(...restored!.drainUntil(start + (day + 1) * DAY_MS - 1));
    });
    second.push(...restored!.flush());

    const tailFromOriginal = first.slice(first.length - second.length);
    expect(second.map((d) => d.delivery_id)).toEqual(tailFromOriginal.map((d) => d.delivery_id));
    expect(second.map((d) => d.payload.delivered_at)).toEqual(
      tailFromOriginal.map((d) => d.payload.delivered_at),
    );
  });

  it("flush() emits every pending late event", () => {
    const { world, start, make } = setup();
    const t = make();
    let pushed = 0;
    for (let day = 0; day < 3; day++) {
      const out = simulateDay(world, day);
      pushed += out.events.length;
      out.events.forEach((e, i) => t.push(e, out.labels[i]!));
      t.drainUntil(start + (day + 1) * DAY_MS - 1);
    }
    expect(t.pending).toBeGreaterThan(0);
    const rest = t.flush();
    expect(rest.length).toBeGreaterThan(0);
    expect(t.pending).toBe(0);
    expect(t.flush()).toEqual([]);
    expect(pushed).toBeGreaterThan(0);
  });

  it("adding a second sink changes neither the first sink's output nor the truth", () => {
    const { world, start, make } = setup();
    const solo = make("primary-file");
    const withOther = make("primary-file");
    const other = make("second-sink");
    const soloOut: string[] = [];
    const pairOut: string[] = [];
    for (let day = 0; day < 4; day++) {
      const out = simulateDay(world, day);
      out.events.forEach((e, i) => {
        solo.push(e, out.labels[i]!);
        withOther.push(e, out.labels[i]!);
        other.push(e, out.labels[i]!);
      });
      const until = start + (day + 1) * DAY_MS - 1;
      soloOut.push(...solo.drainUntil(until).map((d) => d.delivery_id));
      pairOut.push(...withOther.drainUntil(until).map((d) => d.delivery_id));
      other.drainUntil(until);
    }
    expect(pairOut).toEqual(soloOut);
  });
});
