import type { ImperfectionRateConfig } from "@txloom/spec";
import type { Rng } from "../rng.js";

/** Whether this event's delivered position should swap with its successor —
 * the pipeline (pipeline.ts) performs the actual adjacent swap once it has the
 * full ordered batch in hand. */
export function shouldReorder(config: ImperfectionRateConfig, rng: Rng): boolean {
  return rng.nextFloat() < config.rate;
}
