import { describe, expect, it } from "vitest";
import type { SimulationSpec } from "@txloom/spec";
import {
  defaultPartitionCount,
  estimateRun,
  generateMerchantPool,
  generatePartition,
} from "../src/index.js";
import { referenceScenarioSpec } from "./fixtures.js";
import tinyFixture from "../../../apps/e2e/fixtures/tiny-scenario.json" with { type: "json" };
import imperfectionsFixture from "../../../apps/e2e/fixtures/imperfections-all.json" with { type: "json" };
import { referenceSpec } from "../../../benchmarks/batch/lib.js";

function actualEventCount(spec: SimulationSpec): number {
  const seed = BigInt(spec.seed);
  const partitions = defaultPartitionCount(spec.population.consumers.count);
  const merchants = generateMerchantPool(spec, seed);
  let total = 0;
  for (let p = 0; p < partitions; p++) {
    total += generatePartition(spec, seed, p, partitions, merchants).truthEvents.length;
  }
  return total;
}

const options = { replayHistory: false, throughputPerThread: 150_000, threads: 4 };

describe("estimateRun", () => {
  const fixtures: [string, SimulationSpec][] = [
    ["e2e tiny scenario", tinyFixture as unknown as SimulationSpec],
    ["e2e imperfections-all", imperfectionsFixture as unknown as SimulationSpec],
    ["engine reference scenario", referenceScenarioSpec()],
    // The 200k × 90-day reference spec at 1% scale.
    [
      "batch reference spec at 1% scale",
      referenceSpec({ consumers: 2_000, merchants: 50, days: 90 }),
    ],
  ];

  for (const [name, spec] of fixtures) {
    it(`is within ±10% of the actual generated event count: ${name}`, () => {
      const actual = actualEventCount(spec);
      const estimate = estimateRun(spec, options);
      expect(actual).toBeGreaterThan(0);
      expect(Math.abs(estimate.history_events - actual) / actual).toBeLessThanOrEqual(0.1);
    });
  }

  it("reports the partition count the generator will use", () => {
    const spec = referenceSpec({ consumers: 45_000, merchants: 50, days: 1 });
    expect(estimateRun(spec, options).partitions).toBe(defaultPartitionCount(45_000));
  });

  it("returns zero replay messages unless replaying, and accounts for the duplicate rate when replaying", () => {
    const spec = structuredClone(referenceScenarioSpec());
    spec.output.sinks = [
      { type: "file", name: "archive", format: "parquet" },
      { type: "kafka", name: "events" },
    ];
    spec.imperfections = { duplicate_delivery: { rate: 0.1, sinks: ["events"] } };

    const off = estimateRun(spec, { ...options, replayHistory: false });
    expect(off.replay_messages).toBe(0);

    const on = estimateRun(spec, { ...options, replayHistory: true });
    expect(on.replay_messages).toBeGreaterThan(on.history_events);
    expect(on.replay_messages / on.history_events).toBeCloseTo(1.1, 2);

    // A duplicate rate that targets another sink doesn't inflate this sink's replay.
    spec.imperfections = { duplicate_delivery: { rate: 0.1, sinks: ["archive"] } };
    const other = estimateRun(spec, { ...options, replayHistory: true });
    expect(other.replay_messages).toBe(other.history_events);
  });

  it("replays nothing when the spec has no broker sink", () => {
    const spec = structuredClone(referenceScenarioSpec());
    spec.output.sinks = [{ type: "file", name: "archive", format: "csv" }];
    expect(estimateRun(spec, { ...options, replayHistory: true }).replay_messages).toBe(0);
  });

  it("derives the generation time from throughput and the usable threads", () => {
    const spec = referenceSpec({ consumers: 100_000, merchants: 100, days: 30 });
    const partitions = defaultPartitionCount(100_000);
    const one = estimateRun(spec, { ...options, threads: 1 });
    const many = estimateRun(spec, { ...options, threads: 64 });
    expect(one.generation_seconds).toBeCloseTo(one.history_events / 150_000, 0);
    // Parallelism is capped by the partition count.
    expect(many.generation_seconds).toBeCloseTo(many.history_events / (150_000 * partitions), 0);
    expect(many.generation_seconds).toBeLessThan(one.generation_seconds);
  });

  it("states its assumptions", () => {
    const { assumptions } = estimateRun(referenceScenarioSpec(), options);
    expect(assumptions.some((a) => a.includes("150,000"))).toBe(true);
  });

  it("completes in under 5 ms even for the full reference spec", () => {
    const spec = referenceSpec();
    estimateRun(spec, options); // warm up
    const startedAt = performance.now();
    estimateRun(spec, { ...options, replayHistory: true });
    expect(performance.now() - startedAt).toBeLessThan(5);
  });
});
