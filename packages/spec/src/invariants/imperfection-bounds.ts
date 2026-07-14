import type { ImperfectionRateConfig, InvariantFn } from "../types.js";
import { toPointer } from "../json-pointer.js";

const IMPERFECTION_KEYS = [
  "duplicate_delivery",
  "late_arrival",
  "out_of_order",
  "clock_skew",
] as const;

/** Every configured imperfection's rate must be in [0, 0.2], and any sink names it
 * targets must be a subset of output.sinks[].name (FR-024/025). */
export const imperfectionBoundsInvariant: InvariantFn = (spec) => {
  const declaredSinks = new Set(spec.output.sinks.map((s) => s.name));
  const violations: ReturnType<InvariantFn> = [];

  for (const key of IMPERFECTION_KEYS) {
    const config = spec.imperfections[key] as ImperfectionRateConfig | undefined;
    if (!config) continue;

    if (config.rate < 0 || config.rate > 0.2) {
      violations.push({
        path: toPointer(["imperfections", key, "rate"]),
        code: "imperfection-rate-out-of-bounds",
        message: `imperfections.${key}.rate is ${config.rate}; it must be between 0 and 0.2 inclusive.`,
      });
    }

    for (const [sinkIndex, sinkName] of (config.sinks ?? []).entries()) {
      if (declaredSinks.has(sinkName)) continue;
      violations.push({
        path: toPointer(["imperfections", key, "sinks", sinkIndex]),
        code: "imperfection-sink-not-declared",
        message:
          `imperfections.${key}.sinks references "${sinkName}", which is not one of ` +
          `output.sinks[].name (${[...declaredSinks].join(", ") || "none declared"}).`,
      });
    }
  }

  return violations;
};
