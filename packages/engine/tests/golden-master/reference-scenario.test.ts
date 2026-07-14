import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { generatePartition, generateMerchantPool } from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

// Fixed seed + fixed spec asserted against committed reference output
// (constitution Principle III). CI fails this on any output drift — an
// intentional behavior change must regenerate the fixture and be declared
// breaking (constitution Principle II).
describe("golden master: reference scenario", () => {
  it("reproduces the committed reference truth-event and label sample exactly", () => {
    const spec = referenceScenarioSpec();
    const seed = BigInt(spec.seed);
    const merchants = generateMerchantPool(spec, seed);
    const result = generatePartition(spec, seed, 0, 1, merchants);

    const referencePath = path.join(import.meta.dirname, "reference-output.json");
    const reference = JSON.parse(readFileSync(referencePath, "utf-8")) as {
      truthEvents: unknown[];
      labelRecords: unknown[];
      achievedFraudRate: number;
    };

    expect(result.truthEvents).toEqual(reference.truthEvents);
    expect(result.labelRecords).toEqual(reference.labelRecords);
    expect(result.achievedFraudRate).toBeCloseTo(reference.achievedFraudRate, 10);
  });
});
