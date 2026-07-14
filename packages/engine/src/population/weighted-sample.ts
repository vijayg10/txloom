import type { Rng } from "../rng.js";

export interface Weighted {
  weight: number;
}

/** Picks one item from `items` with probability proportional to its normalized
 * weight, drawing from the seeded RNG. Shared by archetype, category, and
 * name-pack sampling — the single weighted-choice primitive for the engine. */
export function weightedPick<T extends Weighted>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new Error("weightedPick: items must not be empty");
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let target = rng.nextFloat() * total;
  for (const item of items) {
    target -= item.weight;
    if (target <= 0) return item;
  }
  return items[items.length - 1]!;
}
