import prand from "pure-rand";
import type { RandomGenerator } from "pure-rand";

// Constitution Principle II / D7: the sole seeded PRNG entry for the engine.
// xoroshiro128+ is fast, mature (it powers fast-check), and serializable — its
// getState()/fromState() round-trip is what makes idempotent resume possible.

export interface RngCheckpoint {
  readonly state: readonly number[];
}

export interface Rng {
  /** The underlying pure-rand generator — d3-random distributions bind to this via `.source()`. */
  readonly generator: RandomGenerator;
  /** Uniform float in [0, 1) at ~53-bit precision. */
  nextFloat(): number;
  /** Uniform integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number;
  checkpoint(): RngCheckpoint;
}

function makeRng(generator: RandomGenerator): Rng {
  return {
    generator,
    nextFloat() {
      const hi = prand.unsafeUniformIntDistribution(0, (1 << 26) - 1, generator);
      const lo = prand.unsafeUniformIntDistribution(0, (1 << 27) - 1, generator);
      return (hi * 2 ** 27 + lo) / 2 ** 53;
    },
    nextInt(min, max) {
      return prand.unsafeUniformIntDistribution(min, max, generator);
    },
    checkpoint() {
      const state = generator.getState?.();
      if (!state) throw new Error("RNG generator does not expose getState() — cannot checkpoint.");
      return { state };
    },
  };
}

/** Folds a run seed (arbitrary bigint) into the 32-bit int xoroshiro128plus expects,
 * deterministically — same seed always folds to the same generator seed. */
function foldSeed(seed: bigint): number {
  return Number(BigInt.asIntN(32, seed));
}

export function createRng(seed: bigint): Rng {
  return makeRng(prand.xoroshiro128plus(foldSeed(seed)));
}

/** Reconstructs an Rng from a previously captured checkpoint — the idempotent-resume path (D7). */
export function restoreRng(checkpoint: RngCheckpoint): Rng {
  return makeRng(prand.xoroshiro128plus.fromState(checkpoint.state as number[]));
}

/** Derives a deterministic, collision-free substream for one partition of the persona
 * space (FR-013/018). `jump()` advances the generator by a fixed, enormous step — calling
 * it (partitionNo + 1) times walks to a distinct, non-overlapping region of the period per
 * partition, so no two partitions ever share RNG output for the same root seed. */
export function derivePartitionRng(rootSeed: bigint, partitionNo: number): Rng {
  if (partitionNo < 0 || !Number.isInteger(partitionNo)) {
    throw new Error(`partitionNo must be a non-negative integer, got ${partitionNo}`);
  }
  let generator = prand.xoroshiro128plus(foldSeed(rootSeed));
  for (let i = 0; i <= partitionNo; i++) {
    if (!generator.jump)
      throw new Error("RNG generator does not support jump() — cannot derive substreams.");
    generator = generator.jump();
  }
  return makeRng(generator);
}

/** Reserved substream range for cross-partition, world-scoped generation
 * (merchant pool, party naming) that must stay independent of however many
 * real generation partitions the run uses. */
const NAMED_SUBSTREAM_BASE = 1_000_000;
const NAMED_SUBSTREAM_SPAN = 1_000_000;

/** Derives a deterministic, named substream — for generation steps that happen
 * once per world (not once per partition), e.g. the shared merchant pool or
 * party-name assignment (D18), so they never collide with a real partition's
 * substream regardless of partition count. */
export function deriveNamedRng(rootSeed: bigint, name: string): Rng {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return derivePartitionRng(rootSeed, NAMED_SUBSTREAM_BASE + (hash % NAMED_SUBSTREAM_SPAN));
}
