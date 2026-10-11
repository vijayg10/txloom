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

const MASK_64 = (1n << 64n) - 1n;
const MASK_32 = 0xffff_ffffn;

/** One SplitMix64 step (Vigna): returns the advanced state and the mixed output. Used to
 * spread a seed's full 64 bits across the generator state (research R2). */
export function splitmix64(state: bigint): { state: bigint; value: bigint } {
  const next = (state + 0x9e3779b97f4a7c15n) & MASK_64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return { state: next, value: z ^ (z >> 31n) };
}

function fnv1a64(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & MASK_64;
  }
  return hash;
}

function int32(value: bigint): number {
  return Number(BigInt.asIntN(32, value & MASK_32));
}

/** Expands all 64 bits of a seed into xoroshiro128+'s 4×int32 state. */
function generatorFromSeed64(seed: bigint): RandomGenerator {
  if (seed < 0n || seed > MASK_64) {
    throw new RangeError(`seed must be in 0 … 2^64-1, got ${seed}`);
  }
  const first = splitmix64(seed);
  const second = splitmix64(first.state);
  const state = [
    int32(first.value >> 32n),
    int32(first.value),
    int32(second.value >> 32n),
    int32(second.value),
  ];
  // An all-zero state is the one fixed point of xoroshiro; SplitMix64 makes it astronomically
  // unlikely, but keep the generator valid regardless.
  if (state.reduce((acc, word) => acc | word, 0) === 0) state[0] = 1;
  return prand.xoroshiro128plus.fromState(state);
}

export function createRng(seed: bigint): Rng {
  return makeRng(generatorFromSeed64(seed));
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
  let generator = generatorFromSeed64(rootSeed);
  for (let i = 0; i <= partitionNo; i++) {
    if (!generator.jump)
      throw new Error("RNG generator does not support jump() — cannot derive substreams.");
    generator = generator.jump();
  }
  return makeRng(generator);
}

/** Derives a deterministic, named substream — for generation steps that happen once per
 * world (not once per partition), e.g. the shared merchant pool or party-name assignment
 * (D18). Seeded directly from the name's hash, so it costs nothing however many partitions
 * the run uses and can never collide with a real partition's jump-derived stream. */
export function deriveNamedRng(rootSeed: bigint, name: string): Rng {
  if (rootSeed < 0n || rootSeed > MASK_64) {
    throw new RangeError(`seed must be in 0 … 2^64-1, got ${rootSeed}`);
  }
  return makeRng(generatorFromSeed64(splitmix64(rootSeed ^ fnv1a64(name)).value));
}
