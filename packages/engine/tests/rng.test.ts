import { describe, expect, it } from "vitest";
import { createRng, derivePartitionRng, restoreRng } from "../src/rng.js";

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
