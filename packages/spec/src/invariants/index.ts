import type { InvariantFn } from "../types.js";
import { seasonalityWindowInvariant } from "./seasonality-window.js";
import { weightsSumInvariant } from "./weights-sum.js";
import { fraudRateBoundsInvariant } from "./fraud-rate-bounds.js";
import { dormancySatisfiableInvariant } from "./dormancy-satisfiable.js";
import { imperfectionBoundsInvariant } from "./imperfection-bounds.js";
import { referenceIntegrityInvariant } from "./reference-integrity.js";
import { scaleEnvelopeInvariant } from "./scale-envelope.js";

export {
  seasonalityWindowInvariant,
  weightsSumInvariant,
  fraudRateBoundsInvariant,
  dormancySatisfiableInvariant,
  imperfectionBoundsInvariant,
  referenceIntegrityInvariant,
  scaleEnvelopeInvariant,
};

/** The full semantic-invariant battery — every entry runs against every spec. */
export const ALL_INVARIANTS: readonly { name: string; fn: InvariantFn }[] = [
  { name: "seasonality-window", fn: seasonalityWindowInvariant },
  { name: "weights-sum", fn: weightsSumInvariant },
  { name: "fraud-rate-bounds", fn: fraudRateBoundsInvariant },
  { name: "dormancy-satisfiable", fn: dormancySatisfiableInvariant },
  { name: "imperfection-bounds", fn: imperfectionBoundsInvariant },
  { name: "reference-integrity", fn: referenceIntegrityInvariant },
  { name: "scale-envelope", fn: scaleEnvelopeInvariant },
];
