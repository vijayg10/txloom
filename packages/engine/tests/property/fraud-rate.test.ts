import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { SimulationSpec } from "@txloom/spec";
import { generatePartition, generateMerchantPool } from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

function specWithFraud(targetRate: number, shares: [number, number, number]): SimulationSpec {
  const spec = referenceScenarioSpec();
  spec.fraud = {
    target_rate: targetRate,
    typologies: [
      {
        type: "card_testing",
        share: shares[0],
        params: {
          burst_size_min: 3,
          burst_size_max: 6,
          burst_window_minutes: 5,
          amount_min: 1,
          amount_max: 50,
        },
      },
      {
        type: "account_takeover",
        share: shares[1],
        params: { dormancy_days: 5, drain_step_count: 3 },
      },
      {
        type: "refund_abuse",
        share: shares[2],
        params: { refund_rate: 0.3, max_refunds_per_actor: 3 },
      },
    ],
  };
  return spec;
}

/** SC-005: achieved fraud rate converges to the configured target across
 * typology share configurations, within a tolerance band (not exact-value —
 * constitution Principle III forbids asserting statistical properties exactly). */
describe("fraud rate convergence (SC-005)", () => {
  it.each([
    [0.02, [0.5, 0.3, 0.2]],
    [0.1, [0.34, 0.33, 0.33]],
    [0.2, [1, 0, 0]],
    [0.05, [0, 1, 0]],
  ] as const)("target_rate=%f, shares=%o converges within tolerance", (targetRate, shares) => {
    const spec = specWithFraud(targetRate, [...shares] as [number, number, number]);
    const seed = BigInt(spec.seed);
    const merchants = generateMerchantPool(spec, seed);
    const result = generatePartition(spec, seed, 0, 1, merchants);

    expect(result.achievedFraudRate).toBeGreaterThan(0);
    expect(Math.abs(result.achievedFraudRate - targetRate)).toBeLessThan(0.03);
  });

  it("property: achieved rate stays within tolerance across a range of target rates", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 0.3, noNaN: true }), (targetRate) => {
        const spec = specWithFraud(targetRate, [0.5, 0.3, 0.2]);
        const seed = BigInt(spec.seed);
        const merchants = generateMerchantPool(spec, seed);
        const result = generatePartition(spec, seed, 0, 1, merchants);

        expect(Math.abs(result.achievedFraudRate - targetRate)).toBeLessThan(0.04);
      }),
      { numRuns: 10 },
    );
  });
});
