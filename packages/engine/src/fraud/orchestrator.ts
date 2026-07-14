import type { FraudConfig } from "@txloom/spec";
import type { Rng } from "../rng.js";
import { randInt } from "../distributions.js";
import type { TruthEvent, LabelRecord } from "../types.js";
import type { NamedConsumer } from "../population/named-population.js";
import type { NamedMerchant } from "../population/named-population.js";
import { generateCardTestingBurst } from "./card-testing.js";
import { generateAccountTakeoverScript } from "./account-takeover.js";
import { maybeGenerateRefund } from "./refund-abuse.js";
import { drawCardTestingOutcome, drawAccountTakeoverOutcome } from "../outcomes.js";

export interface FraudOrchestrationInput {
  fraudConfig: FraudConfig;
  /** This partition's already-generated legitimate events, chronologically sorted. */
  legitEvents: readonly TruthEvent[];
  consumers: readonly NamedConsumer[];
  merchants: readonly NamedMerchant[];
  currency: string;
  channel: string;
  clockStartMs: number;
  clockDays: number;
  partitionNo: number;
  rng: Rng;
  makeId: (seedTimeMs: number) => string;
}

export interface FraudOrchestrationResult {
  fraudEvents: TruthEvent[];
  fraudLabels: LabelRecord[];
  /** fraudEvents.length / (legitEvents.length + fraudEvents.length) — reported for
   * the realism report's achieved-vs-target comparison (FR-017/020). */
  achievedRate: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Allocates the fraud budget across typologies by share, weaves each typology's
 * campaigns into the partition's legitimate traffic, and emits both the fraud
 * TruthEvents and their ground-truth labels (typology, actor, campaign step).
 */
export function orchestrateFraud(input: FraudOrchestrationInput): FraudOrchestrationResult {
  const {
    fraudConfig,
    legitEvents,
    consumers,
    merchants,
    currency,
    channel,
    clockStartMs,
    clockDays,
    partitionNo,
    rng,
    makeId,
  } = input;

  if (consumers.length === 0 || merchants.length === 0 || legitEvents.length === 0) {
    return { fraudEvents: [], fraudLabels: [], achievedRate: 0 };
  }

  const targetRate = fraudConfig.target_rate;
  const fraudBudget = Math.round(
    (targetRate * legitEvents.length) / Math.max(1e-9, 1 - targetRate),
  );

  const fraudEvents: TruthEvent[] = [];
  const fraudLabels: LabelRecord[] = [];
  let actorSeq = 0;

  for (const typology of fraudConfig.typologies) {
    const typologyBudget = Math.round(fraudBudget * typology.share);
    const maxAttempts = typologyBudget * 20 + 200;
    let generated = 0;
    let attempts = 0;

    while (generated < typologyBudget && attempts < maxAttempts) {
      attempts++;
      const actorConsumer = consumers[randInt(rng, 0, consumers.length)]!;
      const actorId = `actor_p${partitionNo}_${actorSeq++}`;

      if (typology.type === "card_testing") {
        const drafts = generateCardTestingBurst(typology.params, rng);
        const dayIndex = randInt(rng, 0, clockDays);
        const anchorMs = clockStartMs + dayIndex * DAY_MS;
        for (const draft of drafts) {
          if (generated >= typologyBudget) break;
          const merchant = merchants[randInt(rng, 0, merchants.length)]!;
          const ts = new Date(anchorMs + draft.offsetMs).toISOString();
          const status = drawCardTestingOutcome(rng, draft.campaignStep === drafts.length - 1);
          const eventId = makeId(anchorMs + draft.offsetMs);
          fraudEvents.push({
            event_id: eventId,
            ts,
            type: "payment",
            status,
            amount: draft.amount,
            currency,
            consumer_id: actorConsumer.id,
            consumer_name: actorConsumer.name,
            merchant_id: merchant.id,
            merchant_name: merchant.name,
            counterparty_id: null,
            counterparty_name: null,
            channel,
            partition_no: partitionNo,
          });
          fraudLabels.push({
            event_id: eventId,
            is_fraud: true,
            typology: "card_testing",
            actor_id: actorId,
            campaign_step: draft.campaignStep,
            corruption_type: null,
            corruption_detail: null,
            sink: null,
          });
          generated++;
        }
      } else if (typology.type === "account_takeover") {
        const dormancyMs = typology.params.dormancy_days * DAY_MS;
        const anchorMs = clockStartMs + Math.min(dormancyMs, Math.max(0, clockDays - 1) * DAY_MS);
        const drafts = generateAccountTakeoverScript(typology.params, rng);
        const drainTarget = consumers[randInt(rng, 0, consumers.length)]!;
        for (const draft of drafts) {
          if (generated >= typologyBudget) break;
          const ts = new Date(anchorMs + draft.offsetMs).toISOString();
          const status = drawAccountTakeoverOutcome(rng);
          const eventId = makeId(anchorMs + draft.offsetMs);
          fraudEvents.push({
            event_id: eventId,
            ts,
            type: "p2p_transfer",
            status,
            amount: draft.amount,
            currency,
            consumer_id: actorConsumer.id,
            consumer_name: actorConsumer.name,
            merchant_id: null,
            merchant_name: null,
            counterparty_id: drainTarget.id,
            counterparty_name: drainTarget.name,
            channel,
            partition_no: partitionNo,
          });
          fraudLabels.push({
            event_id: eventId,
            is_fraud: true,
            typology: "account_takeover",
            actor_id: actorId,
            campaign_step: draft.campaignStep,
            corruption_type: null,
            corruption_detail: null,
            sink: null,
          });
          generated++;
        }
      } else {
        const purchases = legitEvents.filter(
          (e) => e.type === "payment" && e.consumer_id === actorConsumer.id,
        );
        if (purchases.length === 0) continue;
        const purchase = purchases[randInt(rng, 0, purchases.length)]!;
        const draft = maybeGenerateRefund(typology.params, 0, purchase.amount, rng);
        if (!draft) continue;
        const ts = new Date(Date.parse(purchase.ts) + draft.offsetMs).toISOString();
        const eventId = makeId(Date.parse(purchase.ts) + draft.offsetMs);
        fraudEvents.push({
          event_id: eventId,
          ts,
          type: "refund",
          status: "approved",
          amount: draft.amount,
          currency,
          consumer_id: purchase.consumer_id,
          consumer_name: purchase.consumer_name,
          merchant_id: purchase.merchant_id,
          merchant_name: purchase.merchant_name,
          counterparty_id: null,
          counterparty_name: null,
          channel,
          partition_no: partitionNo,
        });
        fraudLabels.push({
          event_id: eventId,
          is_fraud: true,
          typology: "refund_abuse",
          actor_id: actorId,
          campaign_step: 0,
          corruption_type: null,
          corruption_detail: null,
          sink: null,
        });
        generated++;
      }
    }
  }

  const total = legitEvents.length + fraudEvents.length;
  return { fraudEvents, fraudLabels, achievedRate: total > 0 ? fraudEvents.length / total : 0 };
}
