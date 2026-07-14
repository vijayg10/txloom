import type { InvariantFn } from "../types.js";
import { toPointer } from "../json-pointer.js";

/** fraud.target_rate must fall in [0, 0.5]. */
export const fraudRateBoundsInvariant: InvariantFn = (spec) => {
  const rate = spec.fraud.target_rate;
  if (rate >= 0 && rate <= 0.5) return [];
  return [
    {
      path: toPointer(["fraud", "target_rate"]),
      code: "fraud-rate-out-of-bounds",
      message: `fraud.target_rate is ${rate}; it must be between 0 and 0.5 inclusive.`,
    },
  ];
};
