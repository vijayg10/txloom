import type { SimulationSpec } from "@txloom/spec";
import { restoreRng, type Rng } from "../rng.js";
import { createDeterministicUlid } from "../id.js";
import { randInt, drawAmount } from "../distributions.js";
import { drawMerchantAmount } from "../population/merchants.js";
import { drawLegitOutcome } from "../outcomes.js";
import { generatePartition } from "../truth-emit.js";
import type { NamedConsumer, NamedMerchant } from "../population/named-population.js";
import type { LabelRecord, TruthEvent } from "../types.js";

export interface LiveWorldState {
  rng: Rng;
  consumers: readonly NamedConsumer[];
  merchants: readonly NamedMerchant[];
  makeId: (seedTimeMs: number) => string;
}

/**
 * Resumes a partition's world exactly where its history phase left off
 * (FR-029, SC-006): the same consumer population, continuing the same RNG
 * stream, rather than resetting to a fresh world.
 *
 * v1 scope note: this re-derives the checkpoint by re-running the
 * deterministic history generation once (generatePartition is a pure
 * function of seed/partition/spec, so this reproduces the exact trailing
 * RNG state and population — it does not regenerate a *different* world).
 * That's a bounded, one-time cost at stream start, proportional to history
 * length; persisting the checkpoint captured mid-job (run_partitions has a
 * column reserved for exactly this) to skip the replay is a natural
 * follow-up for very large histories.
 */
export function resumeLiveWorld(
  spec: SimulationSpec,
  seed: bigint,
  partitionNo: number,
  partitionCount: number,
  merchants: readonly NamedMerchant[],
): LiveWorldState {
  const { worldCheckpoint } = generatePartition(spec, seed, partitionNo, partitionCount, merchants);
  const rng = restoreRng(worldCheckpoint.rng);
  return {
    rng,
    consumers: worldCheckpoint.consumers,
    merchants,
    makeId: createDeterministicUlid(rng),
  };
}

/**
 * Draws exactly one more live truth event, continuing the world's RNG
 * stream — called once per token the stream's rate limiter releases.
 *
 * v1 scope note: the live phase continues the SAME population's ordinary
 * payment traffic. Fraud typologies (dormancy preconditions, multi-day
 * campaign scripts) are a batch-history concept the orchestrator weaves in
 * over `spec.fraud`; extending campaign scripting into a real-time, +
 * interactive stream is out of scope for v1 (a documented boundary, not an
 * oversight) — the history phase's `fraud.target_rate` already governs the
 * world the stream continues.
 */
export function drawNextLiveEvent(
  spec: SimulationSpec,
  world: LiveWorldState,
  partitionNo: number,
  nowMs: number,
): TruthEvent {
  const consumer = world.consumers[randInt(world.rng, 0, world.consumers.length)];
  if (!consumer) throw new Error("live world has no consumers to draw from");
  const merchant = world.merchants[randInt(world.rng, 0, world.merchants.length)];
  if (!merchant) throw new Error("live world has no merchants to draw from");

  const category = spec.population.merchants.categories[merchant.category];
  const amount = category
    ? drawMerchantAmount(category, world.rng)
    : drawAmount(world.rng, "lognormal", 500, 100);

  return {
    event_id: world.makeId(nowMs),
    ts: new Date(nowMs).toISOString(),
    type: "payment",
    status: drawLegitOutcome(spec.outcomes, world.rng),
    amount,
    currency: spec.currency,
    consumer_id: consumer.id,
    consumer_name: consumer.name,
    merchant_id: merchant.id,
    merchant_name: merchant.name,
    counterparty_id: null,
    counterparty_name: null,
    channel: spec.channel,
    partition_no: partitionNo,
  };
}

/** The answer-key row for a live-drawn event — always clean legitimate
 * traffic per the drawNextLiveEvent scope note above. */
export function liveEventLabel(event: TruthEvent): LabelRecord {
  return {
    event_id: event.event_id,
    is_fraud: false,
    typology: null,
    actor_id: null,
    campaign_step: null,
    corruption_type: null,
    corruption_detail: null,
    sink: null,
  };
}
