import type { InvariantFn } from "../types.js";

/** `spec.seed` must be a safe JSON integer: larger values lose precision in JSON numbers and
 * in most clients, so the full 64-bit range is reached through the launch `seed` string. */
export const seedRangeInvariant: InvariantFn = (spec) => {
  if (Number.isSafeInteger(spec.seed) && spec.seed >= 0) return [];
  return [
    {
      path: "/seed",
      code: "seed-out-of-range",
      message: `seed (${spec.seed}) must be an integer from 0 to ${Number.MAX_SAFE_INTEGER}; pass larger seeds as the launch \`seed\` string (up to 2^64-1).`,
      severity: "error",
    },
  ];
};
