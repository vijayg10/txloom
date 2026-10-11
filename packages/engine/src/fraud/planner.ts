import type { Rng } from "../rng.js";
import { randInt } from "../distributions.js";
import { drawAccountTakeoverOutcome, drawCardTestingOutcome } from "../outcomes.js";
import type { LabelRecord, TruthEvent } from "../types.js";
import {
  type PartitionWorld,
  type PurchaseRing,
  type ScheduledFraudEvent,
} from "../world/partition-world.js";
import { generateCardTestingBurst } from "./card-testing.js";
import { generateAccountTakeoverScript } from "./account-takeover.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const REFUND_MIN_DELAY_MS = 30 * 60_000;
const REFUND_DELAY_SPREAD_MS = 4 * 60 * 60_000;

function schedule(world: PartitionWorld, event: Omit<ScheduledFraudEvent, "seq">): void {
  world.pendingFraud.push({ ...event, seq: world.scheduleSeq++ });
}

function bernoulliCount(expected: number, rng: Rng): number {
  const whole = Math.floor(expected);
  return whole + (rng.nextFloat() < expected - whole ? 1 : 0);
}

/**
 * Plans the fraud campaigns that start on `dayIndex` (R6). The target rate is met by feedback,
 * not by a global budget: each typology is owed `rate/(1−rate) × share × legitimate volume so
 * far (plus today's expected volume)`, and this day plans whatever it is still short. Skipped
 * events (see `drainDay`) are subtracted again, so the shortfall is re-planned.
 *
 * Campaigns are pushed onto `world.pendingFraud` keyed by simulated time, so one that starts
 * late on the last history day simply continues into live days.
 */
export function planDay(world: PartitionWorld, dayIndex: number, expectedLegitCount: number): void {
  const { spec, rng, consumers, merchants } = world;
  const { target_rate: targetRate, typologies } = spec.fraud;
  if (consumers.length === 0 || merchants.length === 0 || targetRate <= 0) return;

  const clockStartMs = Date.parse(`${spec.clock.start}T00:00:00.000Z`);
  const dayStartMs = clockStartMs + dayIndex * DAY_MS;
  const horizonDays = spec.clock.days;
  const owedPerShare =
    (targetRate / (1 - targetRate)) * (world.planner.legitSeen + expectedLegitCount);

  for (const typology of typologies) {
    const planned = world.planner.fraudPlanned[typology.type] ?? 0;
    const shortfall = owedPerShare * typology.share - planned;
    if (shortfall <= 0) continue;

    if (typology.type === "card_testing") {
      const meanSize = (typology.params.burst_size_min + typology.params.burst_size_max) / 2;
      const campaigns = bernoulliCount(shortfall / meanSize, rng);
      for (let c = 0; c < campaigns; c++) {
        const consumerIndex = randInt(rng, 0, consumers.length);
        const actorId = `actor_p${world.partitionNo}_${world.actorSeq++}`;
        const drafts = generateCardTestingBurst(typology.params, rng);
        const windowMs = typology.params.burst_window_minutes * 60_000;
        const anchorMs = dayStartMs + Math.floor(rng.nextFloat() * Math.max(1, DAY_MS - windowMs));
        for (const draft of drafts) {
          schedule(world, {
            atMs: anchorMs + draft.offsetMs,
            typology: "card_testing",
            actorId,
            campaignStep: draft.campaignStep,
            consumerIndex,
            type: "payment",
            amount: draft.amount,
            status: drawCardTestingOutcome(rng, draft.campaignStep === drafts.length - 1),
            merchantIndex: randInt(rng, 0, merchants.length),
            counterpartyIndex: null,
            refundDelayMs: null,
          });
        }
        world.planner.fraudPlanned.card_testing =
          (world.planner.fraudPlanned.card_testing ?? 0) + drafts.length;
      }
    } else if (typology.type === "account_takeover") {
      const size = typology.params.drain_step_count;
      const campaigns = bernoulliCount(shortfall / size, rng);
      for (let c = 0; c < campaigns; c++) {
        // The anchor is drawn uniformly from the days still ahead of the dormancy period; in
        // live mode (no horizon) it lands exactly `dormancy_days` out.
        const earliest = dayIndex + typology.params.dormancy_days;
        const anchorDay =
          dayIndex < horizonDays
            ? randInt(rng, Math.min(earliest, horizonDays - 1), horizonDays)
            : earliest;
        const anchorMs =
          clockStartMs + anchorDay * DAY_MS + Math.floor(rng.nextFloat() * (DAY_MS / 2));

        let victim = randInt(rng, 0, consumers.length);
        for (let tries = 0; tries < 10 && consumers[victim]!.dormantUntilMs !== null; tries++) {
          victim = randInt(rng, 0, consumers.length);
        }
        const victimState = consumers[victim]!;
        if (victimState.dormantUntilMs !== null) continue;
        victimState.dormantUntilMs = anchorMs;
        victimState.compromised = true;

        const drainTarget = randInt(rng, 0, consumers.length);
        const actorId = `actor_p${world.partitionNo}_${world.actorSeq++}`;
        const drafts = generateAccountTakeoverScript(typology.params, rng);
        for (const draft of drafts) {
          schedule(world, {
            atMs: anchorMs + draft.offsetMs,
            typology: "account_takeover",
            actorId,
            campaignStep: draft.campaignStep,
            consumerIndex: victim,
            type: "p2p_transfer",
            amount: draft.amount,
            status: drawAccountTakeoverOutcome(rng),
            merchantIndex: null,
            counterpartyIndex: drainTarget,
            refundDelayMs: null,
          });
        }
        world.planner.fraudPlanned.account_takeover =
          (world.planner.fraudPlanned.account_takeover ?? 0) + drafts.length;
      }
    } else {
      // Each campaign is one actor attempting up to `max_refunds_per_actor` refunds; every
      // attempt happens with probability `refund_rate`, so the expected size is their product.
      const { refund_rate: refundRate, max_refunds_per_actor: maxRefunds } = typology.params;
      const meanSize = Math.max(1e-6, maxRefunds * refundRate);
      const campaigns = bernoulliCount(shortfall / meanSize, rng);
      for (let c = 0; c < campaigns; c++) {
        const consumerIndex = randInt(rng, 0, consumers.length);
        const actorId = `actor_p${world.partitionNo}_${world.actorSeq++}`;
        let step = 0;
        for (let attempt = 0; attempt < maxRefunds; attempt++) {
          if (rng.nextFloat() >= refundRate) continue;
          schedule(world, {
            atMs: dayStartMs + Math.floor(rng.nextFloat() * DAY_MS),
            typology: "refund_abuse",
            actorId,
            campaignStep: step++,
            consumerIndex,
            type: "refund",
            amount: 0,
            status: "approved",
            merchantIndex: null,
            counterpartyIndex: null,
            refundDelayMs:
              REFUND_MIN_DELAY_MS + Math.floor(rng.nextFloat() * REFUND_DELAY_SPREAD_MS),
          });
          world.planner.fraudPlanned.refund_abuse =
            (world.planner.fraudPlanned.refund_abuse ?? 0) + 1;
        }
      }
    }
  }
}

export interface DrainedFraud {
  events: TruthEvent[];
  labels: LabelRecord[];
}

/**
 * Pops every scheduled fraud event that falls inside `[dayStartMs, dayEndMs)` and turns it into
 * a truth event plus its label. Refund abuse is resolved here, against the consumer's ring of
 * recent purchases (O(1)); an attempt with nothing to refund is dropped and un-planned.
 */
export function drainDay(world: PartitionWorld, dayEndMs: number): DrainedFraud {
  const events: TruthEvent[] = [];
  const labels: LabelRecord[] = [];
  const { spec, consumers, merchants, rng } = world;

  for (;;) {
    const next = world.pendingFraud.peek();
    if (!next || next.atMs >= dayEndMs) break;
    world.pendingFraud.pop();
    const consumer = consumers[next.consumerIndex]!;

    let tsMs = next.atMs;
    let amount = next.amount;
    let merchantIndex = next.merchantIndex;

    if (next.type === "refund") {
      const ring: PurchaseRing | undefined = world.recentPurchases.get(next.consumerIndex);
      if (!ring || ring.entries.length === 0) {
        world.planner.fraudPlanned.refund_abuse =
          (world.planner.fraudPlanned.refund_abuse ?? 1) - 1;
        continue;
      }
      const purchase = ring.entries[randInt(rng, 0, ring.entries.length)]!;
      tsMs = Math.max(next.atMs, purchase.tsMs + (next.refundDelayMs ?? REFUND_MIN_DELAY_MS));
      if (tsMs >= dayEndMs) {
        world.planner.fraudPlanned.refund_abuse =
          (world.planner.fraudPlanned.refund_abuse ?? 1) - 1;
        continue;
      }
      amount = purchase.amount;
      merchantIndex = purchase.merchantIndex;
    }

    const merchant = merchantIndex !== null ? merchants[merchantIndex] : undefined;
    const counterparty =
      next.counterpartyIndex !== null ? consumers[next.counterpartyIndex] : undefined;
    const eventId = world.makeId(tsMs);
    events.push({
      event_id: eventId,
      ts: new Date(tsMs).toISOString(),
      type: next.type,
      status: next.status,
      amount,
      currency: spec.currency,
      consumer_id: consumer.id,
      consumer_name: consumer.name,
      merchant_id: merchant?.id ?? null,
      merchant_name: merchant?.name ?? null,
      counterparty_id: counterparty?.id ?? null,
      counterparty_name: counterparty?.name ?? null,
      channel: spec.channel,
      partition_no: world.partitionNo,
    });
    labels.push({
      event_id: eventId,
      is_fraud: true,
      typology: next.typology,
      actor_id: next.actorId,
      campaign_step: next.campaignStep,
      corruption_type: null,
      corruption_detail: null,
      sink: null,
      delivery_outcome: null,
    });
  }
  return { events, labels };
}
