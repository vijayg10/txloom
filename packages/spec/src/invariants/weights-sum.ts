import type { InvariantFn } from "../types.js";
import { toPointer } from "../json-pointer.js";

const EPSILON = 1e-6;

function checkSum(
  values: number[],
  path: (string | number)[],
  code: string,
  label: string,
): ReturnType<InvariantFn> {
  if (values.length === 0) return [];
  const sum = values.reduce((acc, v) => acc + v, 0);
  if (Math.abs(sum - 1) <= EPSILON) return [];
  return [
    {
      path: toPointer(path),
      code,
      message: `${label} sum to ${sum.toFixed(6)}, not 1 (±${EPSILON}). Adjust the weights so they total 1.`,
    },
  ];
}

/** Consumer archetype weights and fraud typology shares must each sum to 1±ε. */
export const weightsSumInvariant: InvariantFn = (spec) => [
  ...checkSum(
    spec.population.consumers.archetypes.map((a) => a.weight),
    ["population", "consumers", "archetypes"],
    "archetype-weights-not-normalized",
    "population.consumers.archetypes[].weight",
  ),
  ...checkSum(
    Object.values(spec.population.merchants.categories).map((c) => c.weight),
    ["population", "merchants", "categories"],
    "merchant-category-weights-not-normalized",
    "population.merchants.categories[].weight",
  ),
  ...checkSum(
    spec.fraud.typologies.map((t) => t.share),
    ["fraud", "typologies"],
    "fraud-typology-shares-not-normalized",
    "fraud.typologies[].share",
  ),
];
