import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ENGINE_VERSION, generatePartition, generateMerchantPool } from "../../src/index.js";
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
      engine_version: number;
      truthEvents: unknown[];
      labelRecords: unknown[];
      achievedFraudRate: number;
    };

    const failureMessage = "output changed: bump ENGINE_VERSION or revert";
    expect(reference.engine_version, failureMessage).toBe(ENGINE_VERSION);
    expect(result.truthEvents, failureMessage).toEqual(reference.truthEvents);
    expect(result.labelRecords, failureMessage).toEqual(reference.labelRecords);
    expect(result.achievedFraudRate, failureMessage).toBeCloseTo(reference.achievedFraudRate, 10);
  });
});
