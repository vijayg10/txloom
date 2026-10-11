import { describe, expect, it } from "vitest";
import {
  PURCHASE_RING_SIZE,
  generateMerchantPool,
  initPartitionWorld,
  simulateDay,
  type TruthEvent,
} from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

function refundOnlySpec(consumers: number, days: number) {
  const spec = referenceScenarioSpec();
  spec.population.consumers.count = consumers;
  spec.clock.days = days;
  spec.fraud = {
    target_rate: 0.1,
    typologies: [
      { type: "refund_abuse", share: 1, params: { refund_rate: 0.5, max_refunds_per_actor: 4 } },
    ],
  };
  return spec;
}

function generate(spec: ReturnType<typeof refundOnlySpec>) {
  const seed = BigInt(spec.seed);
  const world = initPartitionWorld(spec, seed, 0, 1, generateMerchantPool(spec, seed));
  const events: TruthEvent[] = [];
  const isFraud = new Set<string>();
  for (let day = 0; day < spec.clock.days; day++) {
    const output = simulateDay(world, day);
    events.push(...output.events);
    output.labels.forEach((label) => label.is_fraud && isFraud.add(label.event_id));
  }
  return { world, events, isFraud };
}

describe("refund abuse rings (R6)", () => {
  it("every refund references a prior payment of the same consumer and amount", () => {
    const { events, isFraud } = generate(refundOnlySpec(200, 10));
    const refunds = events.filter((e) => e.type === "refund" && isFraud.has(e.event_id));
    expect(refunds.length).toBeGreaterThan(0);

    for (const refund of refunds) {
      const prior = events.filter(
        (e) =>
          e.type === "payment" &&
          e.consumer_id === refund.consumer_id &&
          e.amount === refund.amount &&
          e.merchant_id === refund.merchant_id &&
          Date.parse(e.ts) < Date.parse(refund.ts),
      );
      expect(prior.length).toBeGreaterThan(0);
    }
  });

  it("no ring ever holds more than 16 purchases", () => {
    const { world } = generate(refundOnlySpec(50, 20));
    for (const ring of world.recentPurchases.values()) {
      expect(ring.entries.length).toBeLessThanOrEqual(PURCHASE_RING_SIZE);
    }
  });

  it("generation time scales roughly linearly with consumers (4k at most 2.5× 2k)", () => {
    const time = (consumers: number) => {
      const spec = refundOnlySpec(consumers, 4);
      const started = performance.now();
      generate(spec);
      return performance.now() - started;
    };
    time(500); // warm up the JIT
    const small = time(2000);
    const large = time(4000);
    expect(large / small).toBeLessThan(2.5);
  }, 60_000);
});
