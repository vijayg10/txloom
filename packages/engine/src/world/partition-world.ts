import type { SimulationSpec } from "@txloom/spec";
import { derivePartitionRng, restoreRng, type Rng } from "../rng.js";
import { createDeterministicUlid } from "../id.js";
import { computeConsumerPartitions } from "../partitioning.js";
import { sampleConsumers } from "../population/consumer-archetypes.js";
import { loadNamePack } from "../naming/pack-loader.js";
import { drawPersonName } from "../naming/assign-names.js";
import type { NamedMerchant } from "../population/named-population.js";
import type { FraudTypology } from "../types.js";
import { createStatsAccumulator, type PartitionStatsAccumulator } from "../realism/aggregators.js";
import { MinHeap } from "./min-heap.js";
import { ENGINE_VERSION } from "../version.js";

export const PURCHASE_RING_SIZE = 16;

export interface ConsumerState {
  id: string;
  name: string;
  archetypeIndex: number;
  /** No payments or income before this instant (account-takeover victims, spec US9-2). */
  dormantUntilMs: number | null;
  compromised: boolean;
}

export interface ScheduledFraudEvent {
  atMs: number;
  /** Tie-breaker so equal-time events pop in a deterministic order. */
  seq: number;
  typology: FraudTypology;
  actorId: string;
  campaignStep: number;
  consumerIndex: number;
  type: "payment" | "p2p_transfer" | "refund";
  amount: number;
  status: "approved" | "declined" | "reversed";
  merchantIndex: number | null;
  counterpartyIndex: number | null;
  /** Refund abuse only: the minimum delay after the purchase it refunds. */
  refundDelayMs: number | null;
}

export interface PurchaseEntry {
  eventId: string;
  amount: number;
  merchantIndex: number;
  tsMs: number;
}

/** A consumer's last 16 purchases — refund abuse picks from here in O(1) (R6). */
export interface PurchaseRing {
  entries: PurchaseEntry[];
  head: number;
}

export function recordPurchase(ring: PurchaseRing, entry: PurchaseEntry): void {
  if (ring.entries.length < PURCHASE_RING_SIZE) {
    ring.entries.push(entry);
  } else {
    ring.entries[ring.head] = entry;
    ring.head = (ring.head + 1) % PURCHASE_RING_SIZE;
  }
}

/** Fraud-planning counters. They are part of the world so that a restored world plans exactly
 * the campaigns an uninterrupted one would. */
export interface PlannerState {
  legitSeen: number;
  fraudPlanned: Record<string, number>;
}

export function compareScheduled(a: ScheduledFraudEvent, b: ScheduledFraudEvent): boolean {
  return a.atMs < b.atMs || (a.atMs === b.atMs && a.seq < b.seq);
}

export interface PartitionWorld {
  spec: SimulationSpec;
  seed: bigint;
  partitionNo: number;
  partitionCount: number;
  rng: Rng;
  makeId: (seedTimeMs: number) => string;
  consumers: ConsumerState[];
  merchants: readonly NamedMerchant[];
  /** Consumers per archetype — the closed-form expected volume the planner needs. */
  archetypeCounts: number[];
  nextDayIndex: number;
  pendingFraud: MinHeap<ScheduledFraudEvent>;
  recentPurchases: Map<number, PurchaseRing>;
  actorSeq: number;
  scheduleSeq: number;
  planner: PlannerState;
  stats: PartitionStatsAccumulator;
}

function countArchetypes(spec: SimulationSpec, consumers: readonly ConsumerState[]): number[] {
  const counts = spec.population.consumers.archetypes.map(() => 0);
  for (const consumer of consumers) counts[consumer.archetypeIndex]!++;
  return counts;
}

export function initPartitionWorld(
  spec: SimulationSpec,
  seed: bigint,
  partitionNo: number,
  partitionCount: number,
  merchants: readonly NamedMerchant[],
): PartitionWorld {
  const range = computeConsumerPartitions(spec.population.consumers.count, partitionCount)[
    partitionNo
  ];
  if (!range) {
    throw new Error(`partitionNo ${partitionNo} out of range for partitionCount ${partitionCount}`);
  }
  const rng = derivePartitionRng(seed, partitionNo);
  const pack = loadNamePack(spec.locale);
  const archetypes = spec.population.consumers.archetypes;
  const consumers: ConsumerState[] = sampleConsumers(archetypes, range.start, range.end, rng).map(
    (c) => ({
      id: c.id,
      name: drawPersonName(pack, rng),
      archetypeIndex: archetypes.indexOf(c.archetype),
      dormantUntilMs: null,
      compromised: false,
    }),
  );

  return {
    spec,
    seed,
    partitionNo,
    partitionCount,
    rng,
    makeId: createDeterministicUlid(rng),
    consumers,
    merchants,
    archetypeCounts: countArchetypes(spec, consumers),
    nextDayIndex: 0,
    pendingFraud: new MinHeap(compareScheduled),
    recentPurchases: new Map(),
    actorSeq: 0,
    scheduleSeq: 0,
    planner: { legitSeen: 0, fraudPlanned: {} },
    stats: createStatsAccumulator(),
  };
}

export interface WorldCheckpoint {
  engineVersion: number;
  partitionNo: number;
  partitionCount: number;
  rngState: number[];
  nextDayIndex: number;
  consumers: ConsumerState[];
  pendingFraud: ScheduledFraudEvent[];
  recentPurchases: [number, PurchaseRing][];
  actorSeq: number;
  scheduleSeq: number;
  planner: PlannerState;
  /** Per-sink imperfection transformer state (R9) — populated once the transformer lands. */
  transformers: Record<string, unknown>;
}

export function checkpointWorld(world: PartitionWorld): WorldCheckpoint {
  const rngState = world.rng.checkpoint().state;
  return {
    engineVersion: ENGINE_VERSION,
    partitionNo: world.partitionNo,
    partitionCount: world.partitionCount,
    rngState: [...rngState],
    nextDayIndex: world.nextDayIndex,
    consumers: world.consumers.map((c) => ({ ...c })),
    pendingFraud: world.pendingFraud.toArray(),
    recentPurchases: [...world.recentPurchases.entries()],
    actorSeq: world.actorSeq,
    scheduleSeq: world.scheduleSeq,
    planner: structuredClone(world.planner),
    transformers: {},
  };
}

export function restoreWorld(
  spec: SimulationSpec,
  seed: bigint,
  checkpoint: WorldCheckpoint,
  merchants: readonly NamedMerchant[],
): PartitionWorld {
  if (checkpoint.engineVersion !== ENGINE_VERSION) {
    throw new Error(
      `Checkpoint was written by engine version ${checkpoint.engineVersion}, but this is version ${ENGINE_VERSION}.`,
    );
  }
  const rng = restoreRng({ state: checkpoint.rngState });
  const consumers = checkpoint.consumers.map((c) => ({ ...c }));
  return {
    spec,
    seed,
    partitionNo: checkpoint.partitionNo,
    partitionCount: checkpoint.partitionCount,
    rng,
    makeId: createDeterministicUlid(rng),
    consumers,
    merchants,
    archetypeCounts: countArchetypes(spec, consumers),
    nextDayIndex: checkpoint.nextDayIndex,
    pendingFraud: MinHeap.fromArray(checkpoint.pendingFraud, compareScheduled),
    recentPurchases: new Map(checkpoint.recentPurchases),
    actorSeq: checkpoint.actorSeq,
    scheduleSeq: checkpoint.scheduleSeq,
    planner: structuredClone(checkpoint.planner),
    stats: createStatsAccumulator(),
  };
}
