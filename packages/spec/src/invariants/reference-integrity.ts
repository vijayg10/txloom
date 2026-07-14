import type { InvariantFn } from "../types.js";
import { toPointer } from "../json-pointer.js";

/** Locale packs shipped with the engine (packages/engine/data/name-packs/<locale>/) — kept
 * here as a small static list so packages/spec never depends on packages/engine (D18). */
export const SHIPPED_LOCALE_PACKS = ["en-IN", "en-US"] as const;

/** clock_skew.sources[].source must reference a declared output sink; spec.locale must
 * reference a shipped name-dictionary pack. */
export const referenceIntegrityInvariant: InvariantFn = (spec) => {
  const violations: ReturnType<InvariantFn> = [];
  const declaredSinks = new Set(spec.output.sinks.map((s) => s.name));

  if (!(SHIPPED_LOCALE_PACKS as readonly string[]).includes(spec.locale)) {
    violations.push({
      path: toPointer(["locale"]),
      code: "locale-pack-not-found",
      message: `locale "${spec.locale}" has no shipped name-dictionary pack. Available: ${SHIPPED_LOCALE_PACKS.join(", ")}.`,
    });
  }

  const clockSkew = spec.imperfections.clock_skew;
  if (clockSkew) {
    for (const [index, source] of clockSkew.sources.entries()) {
      if (declaredSinks.has(source.source)) continue;
      violations.push({
        path: toPointer(["imperfections", "clock_skew", "sources", index, "source"]),
        code: "clock-skew-source-not-declared",
        message:
          `imperfections.clock_skew.sources references "${source.source}", which is not one of ` +
          `output.sinks[].name (${[...declaredSinks].join(", ") || "none declared"}).`,
      });
    }
  }

  return violations;
};
