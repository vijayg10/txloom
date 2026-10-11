import { describe, expect, it } from "vitest";
import {
  ACTIVITY_CURVE_WEIGHTS,
  createAliasSampler,
  generateMerchantPool,
  generatePartition,
} from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

/** χ² critical value for 23 degrees of freedom at α = 0.01. */
const CHI_SQUARE_CRITICAL_23_DF = 41.638;

function chiSquare(observed: number[], expectedShare: number[]): number {
  const total = observed.reduce((a, b) => a + b, 0);
  return observed.reduce((sum, count, hour) => {
    const expected = total * expectedShare[hour]!;
    return sum + (count - expected) ** 2 / expected;
  }, 0);
}

/** A population large enough for a sharp test, with no fraud so nothing else shapes the hours. */
function legitHourHistogram(): number[] {
  const spec = structuredClone(referenceScenarioSpec());
  spec.population.consumers.count = 3000;
  spec.clock.days = 6;
  spec.seasonality = [];
  spec.fraud = { target_rate: 0, typologies: [] };
  const seed = BigInt(spec.seed);
  const { truthEvents } = generatePartition(spec, seed, 0, 1, generateMerchantPool(spec, seed));
  const histogram = new Array<number>(24).fill(0);
  for (const event of truthEvents) histogram[new Date(event.ts).getUTCHours()]!++;
  return histogram;
}

describe("daily activity curve", () => {
  const weightTotal = ACTIVITY_CURVE_WEIGHTS.reduce((a, b) => a + b, 0);
  const curve = ACTIVITY_CURVE_WEIGHTS.map((w) => w / weightTotal);
  const histogram = legitHourHistogram();

  it("the hour-of-day histogram of legitimate events matches the built-in curve", () => {
    expect(histogram.reduce((a, b) => a + b, 0)).toBeGreaterThan(50_000);
    expect(chiSquare(histogram, curve)).toBeLessThan(CHI_SQUARE_CRITICAL_23_DF);
  });

  it("the same test rejects a flat distribution", () => {
    const flat = new Array<number>(24).fill(1 / 24);
    expect(chiSquare(histogram, flat)).toBeGreaterThan(CHI_SQUARE_CRITICAL_23_DF);
  });

  it("the evening peak is busier than the dead of night", () => {
    const night = histogram.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const evening = histogram.slice(17, 21).reduce((a, b) => a + b, 0) / 4;
    expect(evening).toBeGreaterThan(night * 4);
  });
});

describe("alias sampler", () => {
  it("reproduces its weights from uniform draws", () => {
    const sampler = createAliasSampler([1, 3, 6]);
    const counts = [0, 0, 0];
    const draws = 100_000;
    for (let i = 0; i < draws; i++) counts[sampler.pick((i + 0.5) / draws)]!++;
    expect(counts[0]! / draws).toBeCloseTo(0.1, 2);
    expect(counts[1]! / draws).toBeCloseTo(0.3, 2);
    expect(counts[2]! / draws).toBeCloseTo(0.6, 2);
  });

  it("never returns an out-of-range index, even at the edges of [0, 1)", () => {
    const sampler = createAliasSampler(ACTIVITY_CURVE_WEIGHTS);
    for (const u of [0, 1e-12, 0.5, 1 - 1e-12]) {
      const index = sampler.pick(u);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(24);
    }
  });

  it("rejects an empty or all-zero distribution", () => {
    expect(() => createAliasSampler([])).toThrow();
    expect(() => createAliasSampler([0, 0])).toThrow();
  });
});
