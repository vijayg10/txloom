import type { Rng } from "../rng.js";

const HOUR_MS = 60 * 60 * 1000;

/** Built-in hour-of-day activity weights (UTC, R6): a morning and an evening peak with a quiet
 * night. Relative, not probabilities. There is no spec knob for it yet. */
export const ACTIVITY_CURVE_WEIGHTS: readonly number[] = [
  1, 1, 1, 1, 1, 2, 3, 5, 7, 8, 8, 7, 7, 7, 6, 6, 7, 8, 9, 9, 8, 6, 4, 2,
];

/** A discrete distribution sampled in O(1) with a single uniform draw (Vose's alias method). */
export interface AliasSampler {
  readonly size: number;
  /** Maps one uniform draw in `[0, 1)` to an index. */
  pick(uniform: number): number;
}

export function createAliasSampler(weights: readonly number[]): AliasSampler {
  const n = weights.length;
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (n === 0 || !(total > 0)) throw new Error("an alias sampler needs positive total weight");
  const scaled = weights.map((w) => (w / total) * n);
  const probability = new Array<number>(n).fill(1);
  const alias = Array.from({ length: n }, (_, i) => i);
  const small: number[] = [];
  const large: number[] = [];
  scaled.forEach((value, i) => (value < 1 ? small : large).push(i));
  while (small.length > 0 && large.length > 0) {
    const s = small.pop()!;
    const l = large.pop()!;
    probability[s] = scaled[s]!;
    alias[s] = l;
    scaled[l] = scaled[l]! + scaled[s]! - 1;
    (scaled[l]! < 1 ? small : large).push(l);
  }
  // Whatever is left has probability 1 (rounding error aside).
  for (const i of [...small, ...large]) probability[i] = 1;
  return {
    size: n,
    pick(uniform: number): number {
      const position = uniform * n;
      const index = Math.min(n - 1, Math.floor(position));
      return position - index < probability[index]! ? index : alias[index]!;
    },
  };
}

const hourSampler = createAliasSampler(ACTIVITY_CURVE_WEIGHTS);

/** A timestamp within the day starting at `dayStartMs`, hour drawn from the activity curve and
 * the minute uniformly within it. Two RNG draws, always. */
export function drawTimeOfDay(dayStartMs: number, rng: Rng): number {
  const hour = hourSampler.pick(rng.nextFloat());
  return dayStartMs + hour * HOUR_MS + Math.floor(rng.nextFloat() * HOUR_MS);
}
