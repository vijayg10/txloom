import type { SimulationSpec } from "@txloom/spec";
import { deriveNamedRng } from "./rng.js";
import { sampleMerchants } from "./population/merchants.js";
import { loadNamePack } from "./naming/pack-loader.js";
import { drawMerchantName } from "./naming/assign-names.js";
import {
  initPartitionWorld,
  checkpointWorld,
  type WorldCheckpoint,
} from "./world/partition-world.js";
import { simulateDay } from "./world/simulate-day.js";
import type { NamedMerchant } from "./population/named-population.js";
import type { LabelRecord, TruthEvent } from "./types.js";

export interface PartitionGenerationResult {
  truthEvents: TruthEvent[];
  labelRecords: LabelRecord[];
  achievedFraudRate: number;
  /** The world at the end of history — what the live phase restores (R7). */
  worldCheckpoint: WorldCheckpoint;
}

/** Generates the shared, world-scoped merchant pool once (globally, not
 * per-partition) — every partition's consumers can transact with any of them. */
export function generateMerchantPool(spec: SimulationSpec, seed: bigint): NamedMerchant[] {
  const rng = deriveNamedRng(seed, "merchants");
  const pack = loadNamePack(spec.locale);
  const merchants = sampleMerchants(
    spec.population.merchants.categories,
    spec.population.merchants.count,
    rng,
  );
  return merchants.map((m) => ({ ...m, name: drawMerchantName(pack, m.category, rng) }));
}

/**
 * Generates one partition's whole history in memory: a thin loop over `simulateDay` for days
 * `0…clock.days−1` (R6). Kept for tests and small tools; the worker streams the same days to
 * disk one at a time instead of holding them.
 */
export function generatePartition(
  spec: SimulationSpec,
  seed: bigint,
  partitionNo: number,
  partitionCount: number,
  merchants: readonly NamedMerchant[],
): PartitionGenerationResult {
  const world = initPartitionWorld(spec, seed, partitionNo, partitionCount, merchants);
  const truthEvents: TruthEvent[] = [];
  const labelRecords: LabelRecord[] = [];
  for (let day = 0; day < spec.clock.days; day++) {
    const output = simulateDay(world, day);
    for (const event of output.events) truthEvents.push(event);
    for (const label of output.labels) labelRecords.push(label);
  }
  const total = world.stats.eventCount;
  return {
    truthEvents,
    labelRecords,
    achievedFraudRate: total > 0 ? world.stats.fraudCount / total : 0,
    worldCheckpoint: checkpointWorld(world),
  };
}
