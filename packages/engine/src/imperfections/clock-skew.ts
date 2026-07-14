import type { ClockSkewConfig } from "@txloom/spec";
import type { Rng } from "../rng.js";

/** Returns a timestamp offset in milliseconds for a delivery on `sinkName`
 * (0 = no skew) — per-source offsets model a sink whose clock disagrees with
 * truth time. */
export function clockSkewOffsetMs(config: ClockSkewConfig, sinkName: string, rng: Rng): number {
  const source = config.sources.find((s) => s.source === sinkName);
  if (!source) return 0;
  if (rng.nextFloat() >= config.rate) return 0;
  return Math.round(source.offset_seconds * 1000);
}
