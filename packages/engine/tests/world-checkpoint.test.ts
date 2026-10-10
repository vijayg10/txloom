import { describe, expect, it } from "vitest";
import {
  checkpointWorld,
  decodeCheckpoint,
  encodeCheckpoint,
  generateMerchantPool,
  initPartitionWorld,
  restoreWorld,
  simulateDay,
} from "../src/index.js";
import { referenceScenarioSpec } from "./fixtures.js";

describe("world checkpoints (R7)", () => {
  const spec = referenceScenarioSpec();
  const seed = BigInt(spec.seed);
  const merchants = generateMerchantPool(spec, seed);
  const splitDay = 6;

  function freshWorld() {
    return initPartitionWorld(spec, seed, 0, 1, merchants);
  }

  it("a restored world produces byte-identical subsequent days", () => {
    const uninterrupted = freshWorld();
    for (let d = 0; d < splitDay; d++) simulateDay(uninterrupted, d);

    const resumedFrom = freshWorld();
    for (let d = 0; d < splitDay; d++) simulateDay(resumedFrom, d);
    const { bytes, sha256 } = encodeCheckpoint(checkpointWorld(resumedFrom));
    const restored = restoreWorld(spec, seed, decodeCheckpoint(bytes, sha256), merchants);

    for (let d = splitDay; d < spec.clock.days + 3; d++) {
      expect(simulateDay(restored, d)).toEqual(simulateDay(uninterrupted, d));
    }
  });

  it("a tampered checkpoint fails SHA-256 verification with a clear error", () => {
    const world = freshWorld();
    simulateDay(world, 0);
    const { bytes, sha256 } = encodeCheckpoint(checkpointWorld(world));
    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 9] = tampered[tampered.length - 9]! ^ 0xff;
    expect(() => decodeCheckpoint(tampered, sha256)).toThrow(/SHA-256 verification/);
  });

  it("refuses a checkpoint from another engine version", () => {
    const world = freshWorld();
    const checkpoint = { ...checkpointWorld(world), engineVersion: 1 };
    expect(() => restoreWorld(spec, seed, checkpoint, merchants)).toThrow(/engine version 1/);
  });
});
