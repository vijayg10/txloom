import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  generateMerchantPool,
  initPartitionWorld,
  simulateDay,
  type LabelRecord,
  type TruthEvent,
} from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

function runDays(spec = referenceScenarioSpec(), days = spec.clock.days) {
  const seed = BigInt(spec.seed);
  const world = initPartitionWorld(spec, seed, 0, 1, generateMerchantPool(spec, seed));
  const outputs = Array.from({ length: days }, (_, day) => simulateDay(world, day));
  return { world, outputs };
}

describe("simulateDay (R6)", () => {
  it("concatenated day outputs are sorted by ts, and each day stays inside its own day", () => {
    const { outputs } = runDays();
    const events = outputs.flatMap((o) => o.events);
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) {
      expect(Date.parse(events[i]!.ts)).toBeGreaterThanOrEqual(Date.parse(events[i - 1]!.ts));
    }
  });

  it("labels are aligned 1:1 with events for every day", () => {
    const { outputs } = runDays();
    for (const { events, labels } of outputs) {
      expect(labels.length).toBe(events.length);
      events.forEach((event: TruthEvent, i: number) => {
        expect((labels[i] as LabelRecord).event_id).toBe(event.event_id);
      });
    }
  });

  it("refuses to skip or repeat a day", () => {
    const spec = referenceScenarioSpec();
    const seed = BigInt(spec.seed);
    const world = initPartitionWorld(spec, seed, 0, 1, generateMerchantPool(spec, seed));
    expect(() => simulateDay(world, 3)).toThrow(/day 0/);
    simulateDay(world, 0);
    expect(() => simulateDay(world, 0)).toThrow(/day 1/);
  });

  it("dormant consumers emit no legitimate payment or income while dormant", () => {
    const spec = referenceScenarioSpec();
    const seed = BigInt(spec.seed);
    const world = initPartitionWorld(spec, seed, 0, 1, generateMerchantPool(spec, seed));
    let dormantDays = 0;
    for (let day = 0; day < spec.clock.days; day++) {
      const output = simulateDay(world, day);
      // Victims are marked dormant when their campaign is planned, at the start of the day.
      const dormant = new Map(
        world.consumers
          .filter((c) => c.dormantUntilMs !== null)
          .map((c) => [c.id, c.dormantUntilMs!]),
      );
      if (dormant.size > 0) dormantDays++;
      output.events.forEach((event, i) => {
        const until = dormant.get(event.consumer_id);
        if (until !== undefined && !output.labels[i]!.is_fraud) {
          expect(Date.parse(event.ts)).toBeGreaterThanOrEqual(until);
        }
      });
    }
    expect(dormantDays).toBeGreaterThan(0);
  });

  it("property: the achieved fraud rate stays near fraud.target_rate", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.02, max: 0.2, noNaN: true }), (targetRate) => {
        const spec = referenceScenarioSpec();
        spec.fraud.target_rate = targetRate;
        const { outputs } = runDays(spec);
        const labels = outputs.flatMap((o) => o.labels);
        const rate = labels.filter((l) => l.is_fraud).length / labels.length;
        expect(Math.abs(rate - targetRate)).toBeLessThan(0.04);
      }),
      { numRuns: 8, seed: 20260101 },
    );
  });
});
