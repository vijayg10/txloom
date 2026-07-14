import type { IncomePattern } from "@txloom/spec";
import type { Rng } from "../rng.js";
import { normal } from "../distributions.js";

/** Does income land on this calendar day for this pattern? `fixed_credit_day`
 * fires deterministically by day-of-month; `irregular_weekly` fires with ~1/7
 * daily probability, drawn from the RNG so it stays reproducible. */
export function isIncomeDay(pattern: IncomePattern, calendarDate: Date, rng: Rng): boolean {
  if (pattern.kind === "fixed_credit_day") {
    return calendarDate.getUTCDate() === pattern.day_of_month;
  }
  return rng.nextFloat() < 1 / 7;
}

export function drawIncomeAmount(pattern: IncomePattern, rng: Rng): number {
  const amount = normal(rng, pattern.amount_mean, pattern.amount_stddev);
  return Math.max(0.01, Math.round(amount * 100) / 100);
}
