import type { MerchantCategory } from "@txloom/spec";
import type { Rng } from "../rng.js";
import { weightedPick } from "./weighted-sample.js";
import { drawAmount } from "../distributions.js";

export interface Merchant {
  id: string;
  category: string;
}

/** The merchant pool is generated once, globally (not per-partition) — any
 * consumer in any partition can transact with any merchant. */
export function sampleMerchants(
  categories: Record<string, MerchantCategory>,
  count: number,
  rng: Rng,
): Merchant[] {
  const categoryList = Object.values(categories);
  return Array.from({ length: count }, (_, i) => ({
    id: `mch_${i}`,
    category: weightedPick(categoryList, rng).name,
  }));
}

export function drawMerchantAmount(category: MerchantCategory, rng: Rng): number {
  return drawAmount(
    rng,
    category.amount_distribution.kind,
    category.amount_distribution.mean,
    category.amount_distribution.stddev,
  );
}
