import type { LateArrivalConfig } from "@txloom/spec";
import type { Rng } from "../rng.js";
import { normal } from "../distributions.js";

/** Returns a delivery delay in milliseconds (0 = on time). */
export function lateArrivalDelayMs(config: LateArrivalConfig, rng: Rng): number {
  if (rng.nextFloat() >= config.rate) return 0;
  const delaySeconds = Math.max(
    0,
    normal(rng, config.delay_seconds_mean, config.delay_seconds_stddev),
  );
  return Math.round(delaySeconds * 1000);
}
