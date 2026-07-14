import type { SpendRhythm } from "@txloom/spec";
import type { Rng } from "../rng.js";
import { normal } from "../distributions.js";

/** Draws today's transaction count for one consumer — mean scaled by the
 * weekend multiplier, floored at 0 (a quiet day is a valid outcome). */
export function drawDailyTransactionCount(
  rhythm: SpendRhythm,
  isWeekend: boolean,
  rng: Rng,
): number {
  const mean = rhythm.daily_transaction_count_mean * (isWeekend ? rhythm.weekend_multiplier : 1);
  const count = Math.round(normal(rng, mean, rhythm.daily_transaction_count_stddev));
  return Math.max(0, count);
}
