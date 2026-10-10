import { describe, expect, it } from "vitest";
import {
  createRng,
  deriveNamedRng,
  derivePartitionRng,
  restoreRng,
  splitmix64,
} from "../src/rng.js";

describe("seeded RNG determinism (D7)", () => {
  it("identical seed produces an identical stream", () => {
    const a = createRng(12345n);
    const b = createRng(12345n);

    const streamA = Array.from({ length: 50 }, () => a.nextFloat());
    const streamB = Array.from({ length: 50 }, () => b.nextFloat());

    expect(streamA).toEqual(streamB);
  });

  it("different seeds produce different streams", () => {
    const a = createRng(1n);
    const b = createRng(2n);

    const streamA = Array.from({ length: 20 }, () => a.nextFloat());
    const streamB = Array.from({ length: 20 }, () => b.nextFloat());

    expect(streamA).not.toEqual(streamB);
  });

  it("per-partition substream derivation is deterministic", () => {
    const root = 999n;
    const first = derivePartitionRng(root, 3);
    const second = derivePartitionRng(root, 3);

    expect(first.nextFloat()).toEqual(second.nextFloat());
  });

  it("per-partition substreams are collision-free across partition indices", () => {
    const root = 999n;
    const partitionCount = 64;
    const samples = Array.from({ length: partitionCount }, (_, partitionNo) =>
      derivePartitionRng(root, partitionNo).nextFloat(),
    );

    expect(new Set(samples).size).toBe(partitionCount);
  });

  it("substreams differ from the root stream and from each other", () => {
    const root = createRng(42n);
    const rootFirst = root.nextFloat();

    const p0 = derivePartitionRng(42n, 0).nextFloat();
    const p1 = derivePartitionRng(42n, 1).nextFloat();

    expect(p0).not.toEqual(rootFirst);
    expect(p0).not.toEqual(p1);
  });

  it("checkpoint/restore reproduces the exact continuation of the stream", () => {
    const rng = createRng(555n);
    rng.nextFloat();
    rng.nextFloat();
    const checkpoint = rng.checkpoint();

    const continued = Array.from({ length: 10 }, () => rng.nextFloat());

    const restored = restoreRng(checkpoint);
    const replay = Array.from({ length: 10 }, () => restored.nextFloat());

    expect(replay).toEqual(continued);
  });
});

describe("64-bit seeding (R2, R3)", () => {
  it("seeds 1n and 2n**32n + 1n give different first 1,000 draws", () => {
    const a = createRng(1n);
    const b = createRng(2n ** 32n + 1n);
    const drawsA = Array.from({ length: 1000 }, () => a.nextFloat());
    const drawsB = Array.from({ length: 1000 }, () => b.nextFloat());
    expect(drawsA).not.toEqual(drawsB);
    expect(drawsA[0]).not.toEqual(drawsB[0]);
  });

  it("accepts the maximum 64-bit seed and rejects anything outside 0 … 2^64-1", () => {
    expect(() => createRng(2n ** 64n - 1n).nextFloat()).not.toThrow();
    expect(() => createRng(2n ** 64n)).toThrow(RangeError);
    expect(() => createRng(-1n)).toThrow(RangeError);
  });

  it("SplitMix64 matches the published vectors for state 0", () => {
    const first = splitmix64(0n);
    const second = splitmix64(first.state);
    const third = splitmix64(second.state);
    expect(first.value).toBe(0xe220a8397b1dcdafn);
    expect(second.value).toBe(0x6e789e6aa1b965f4n);
    expect(third.value).toBe(0x06c45d188009454fn);
  });

  it("deriveNamedRng is cheap and differs between names and seeds", () => {
    const started = performance.now();
    const merchants = deriveNamedRng(42n, "merchants").nextFloat();
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(1);

    expect(deriveNamedRng(42n, "parties").nextFloat()).not.toEqual(merchants);
    expect(deriveNamedRng(43n, "merchants").nextFloat()).not.toEqual(merchants);
    expect(deriveNamedRng(42n, "merchants").nextFloat()).toEqual(merchants);
  });
});
