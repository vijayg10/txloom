import type { InvariantFn } from "../types.js";
import { toPointer } from "../json-pointer.js";

/** An account_takeover typology's dormancy precondition must fit within clock.days —
 * otherwise no persona can ever satisfy it and the typology can never fire. */
export const dormancySatisfiableInvariant: InvariantFn = (spec) =>
  spec.fraud.typologies.flatMap((typology, index) => {
    if (typology.type !== "account_takeover") return [];
    if (typology.params.dormancy_days < spec.clock.days) return [];
    return [
      {
        path: toPointer(["fraud", "typologies", index, "params", "dormancy_days"]),
        code: "dormancy-not-satisfiable",
        message:
          `account_takeover dormancy_days (${typology.params.dormancy_days}) must be less than ` +
          `clock.days (${spec.clock.days}) so at least one persona can complete the dormancy ` +
          `precondition before the run ends. Reduce dormancy_days or increase clock.days.`,
      },
    ];
  });
