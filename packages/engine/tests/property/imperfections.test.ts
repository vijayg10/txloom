import { describe, expect, it } from "vitest";
import type { SimulationSpec } from "@txloom/spec";
import {
  deriveNamedRng,
  generateMerchantPool,
  ImperfectionTransformer,
  initPartitionWorld,
  simulateDay,
  type Delivered,
  type LabelRecord,
  type TruthEvent,
} from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

const DAY_MS = 86_400_000;

function twoSinkSpec(): SimulationSpec {
  const spec = referenceScenarioSpec();
  spec.population.consumers.count = 200;
  spec.output.sinks = [
    { type: "file", name: "sink-a", format: "parquet" },
    { type: "file", name: "sink-b", format: "parquet" },
  ];
  spec.imperfections = {
    duplicate_delivery: { rate: 0.1, sinks: ["sink-a"] },
    late_arrival: {
      rate: 0.1,
      delay_seconds_mean: 4 * 3600,
      delay_seconds_stddev: 600,
      sinks: ["sink-a"],
    },
    out_of_order: { rate: 0.1, sinks: ["sink-a"] },
    clock_skew: {
      rate: 0.1,
      sources: [{ source: "sink-a", offset_seconds: 90 }],
      sinks: ["sink-a"],
    },
  };
  return spec;
}

interface Run {
  truth: TruthEvent[];
  labels: LabelRecord[];
  delivered: Delivered[];
}

/** Simulates the whole partition, then drives one transformer day by day like the worker does. */
function run(spec: SimulationSpec, sinkName: string): Run {
  const seed = BigInt(spec.seed);
  const merchants = generateMerchantPool(spec, seed);
  const world = initPartitionWorld(spec, seed, 0, 1, merchants);
  const transformer = ImperfectionTransformer.create(
    sinkName,
    spec.imperfections,
    deriveNamedRng(seed, `imperfections:${sinkName}:p0`),
  );
  const truth: TruthEvent[] = [];
  const labels: LabelRecord[] = [];
  const delivered: Delivered[] = [];
  const clockStartMs = Date.parse(`${spec.clock.start}T00:00:00.000Z`);
  for (let day = 0; day < spec.clock.days; day++) {
    const out = simulateDay(world, day);
    out.events.forEach((event, i) => {
      truth.push(event);
      labels.push(out.labels[i]!);
      transformer.push(event, out.labels[i]!);
    });
    for (const d of transformer.drainUntil(clockStartMs + (day + 1) * DAY_MS - 1))
      delivered.push(d);
  }
  for (const d of transformer.flush()) delivered.push(d);
  return { truth, labels, delivered };
}

describe("ImperfectionTransformer (FR-020/024/025, R9)", () => {
  const spec = twoSinkSpec();
  const truthSnapshot = JSON.stringify(run(spec, "sink-b").truth);
  const a = run(spec, "sink-a");
  const b = run(spec, "sink-b");
  const corruptions = a.delivered.flatMap((d) => d.corruptions);
  const ofType = (type: string) => corruptions.filter((c) => c.corruption_type === type);
  const truthById = new Map(a.truth.map((e) => [e.event_id, e]));

  it("never mutates truth events", () => {
    expect(JSON.stringify(a.truth)).toBe(truthSnapshot);
  });

  it("produces every configured imperfection", () => {
    for (const type of ["duplicate", "late", "out_of_order", "clock_skew"]) {
      expect(ofType(type).length, type).toBeGreaterThan(0);
    }
  });

  it("every corruption label has a matching delivered record in the same sink", () => {
    for (const d of a.delivered) {
      for (const c of d.corruptions) {
        expect(c.event_id).toBe(d.event_id);
        expect(c.sink).toBe("sink-a");
      }
    }
    const deliveredIds = new Set(a.delivered.map((d) => d.event_id));
    for (const c of corruptions) expect(deliveredIds.has(c.event_id)).toBe(true);
  });

  it("delivers every truth event at least once", () => {
    const deliveredIds = new Set(a.delivered.map((d) => d.event_id));
    for (const e of a.truth) expect(deliveredIds.has(e.event_id)).toBe(true);
  });

  it("late records keep their original ts and are emitted after earlier delivered_at records", () => {
    const late = a.delivered.filter((d) => d.corruptions.some((c) => c.corruption_type === "late"));
    expect(late.length).toBeGreaterThan(0);
    for (const d of late) {
      const truth = truthById.get(d.event_id)!;
      const skewed = d.corruptions.some((c) => c.corruption_type === "clock_skew");
      if (!skewed) expect(d.payload.ts).toBe(truth.ts);
      expect(Date.parse(d.payload.delivered_at)).toBeGreaterThan(Date.parse(truth.ts));
    }
    // Apart from deliberate out-of-order swaps and duplicates, delivery follows delivered_at.
    const inOrder = a.delivered.filter(
      (d) =>
        !d.corruptions.some(
          (c) => c.corruption_type === "out_of_order" || c.corruption_type === "duplicate",
        ),
    );
    for (let i = 1; i < inOrder.length; i++) {
      expect(Date.parse(inOrder[i]!.payload.delivered_at)).toBeGreaterThanOrEqual(
        Date.parse(inOrder[i - 1]!.payload.delivered_at),
      );
    }
  });

  it("skewed records have ts = truth ts + offset exactly", () => {
    const skewed = a.delivered.filter((d) =>
      d.corruptions.some((c) => c.corruption_type === "clock_skew"),
    );
    expect(skewed.length).toBeGreaterThan(0);
    for (const d of skewed) {
      const truth = truthById.get(d.event_id)!;
      expect(Date.parse(d.payload.ts)).toBe(Date.parse(truth.ts) + 90_000);
    }
  });

  it("duplicates share event_id but have distinct delivery_ids", () => {
    const ids = a.delivered.map((d) => d.delivery_id);
    expect(new Set(ids).size).toBe(ids.length);
    const copies = new Map<string, number>();
    for (const d of a.delivered) copies.set(d.event_id, (copies.get(d.event_id) ?? 0) + 1);
    for (const c of ofType("duplicate")) expect(copies.get(c.event_id)!).toBeGreaterThan(1);
  });

  it("an imperfection targeting sink A leaves sink B clean", () => {
    expect(b.delivered.length).toBe(b.truth.length);
    expect(b.delivered.every((d) => d.corruptions.length === 0)).toBe(true);
    expect(b.delivered.map((d) => d.event_id)).toEqual(b.truth.map((e) => e.event_id));
    for (const d of b.delivered) {
      expect(d.payload.ts).toBe(truthById.get(d.event_id)!.ts);
      expect(d.payload.delivered_at).toBe(d.payload.ts);
      expect(d.payload.sent_at).toBeNull();
    }
  });

  it("each rate lands within tolerance", () => {
    const n = a.truth.length;
    const tolerance = 4 * Math.sqrt((0.1 * 0.9) / n);
    expect(Math.abs(ofType("duplicate").length / n - 0.1)).toBeLessThan(tolerance);
    expect(Math.abs(ofType("late").length / n - 0.1)).toBeLessThan(tolerance);
    expect(Math.abs(ofType("clock_skew").length / n - 0.1)).toBeLessThan(tolerance);
    // Out-of-order is only labelled when a successor really overtakes, so it can fall a little short.
    expect(ofType("out_of_order").length / n).toBeGreaterThan(0.1 - tolerance - 0.03);
    expect(ofType("out_of_order").length / n).toBeLessThan(0.1 + tolerance);
  });

  it("an out_of_order label means the delivery really came after its successor", () => {
    const position = new Map(a.delivered.map((d, i) => [d.delivery_id, i]));
    for (const d of a.delivered) {
      if (!d.corruptions.some((c) => c.corruption_type === "out_of_order")) continue;
      const index = position.get(d.delivery_id)!;
      // Something that was due no earlier than this record was delivered before it.
      const overtaken = a.delivered
        .slice(0, index)
        .some(
          (x) =>
            x.event_id !== d.event_id &&
            Date.parse(x.payload.delivered_at) >= Date.parse(d.payload.delivered_at),
        );
      expect(overtaken).toBe(true);
    }
  });

  it("delivered fraud labels stay aligned with their events", () => {
    for (const d of a.delivered) expect(d.fraudLabel.event_id).toBe(d.event_id);
  });
});
