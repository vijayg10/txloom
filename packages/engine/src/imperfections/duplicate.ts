import type { ImperfectionRateConfig } from "@txloom/spec";
import type { Rng } from "../rng.js";

/** Returns how many *extra* delivered copies to emit for this event on this
 * sink (0 = no duplicate). Truth is untouched — duplicates only affect the
 * delivered stream (FR-024/025). */
export function extraDuplicateCount(config: ImperfectionRateConfig, rng: Rng): number {
  return rng.nextFloat() < config.rate ? 1 : 0;
}
