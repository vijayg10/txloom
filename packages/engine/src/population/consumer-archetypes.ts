import type { ConsumerArchetype } from "@txloom/spec";
import type { Rng } from "../rng.js";
import { weightedPick } from "./weighted-sample.js";

export interface Consumer {
  id: string;
  archetype: ConsumerArchetype;
}

/** Assigns each consumer in [startIndex, endIndex) a weighted-sampled archetype
 * (FR-013). Index-addressed IDs keep assignment a pure function of index + RNG
 * draw order, so a partition's slice never depends on other partitions. */
export function sampleConsumers(
  archetypes: readonly ConsumerArchetype[],
  startIndex: number,
  endIndex: number,
  rng: Rng,
): Consumer[] {
  const consumers: Consumer[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    consumers.push({ id: `cons_${i}`, archetype: weightedPick(archetypes, rng) });
  }
  return consumers;
}
