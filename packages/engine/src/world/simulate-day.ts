import { randInt } from "../distributions.js";
import { seasonalityMultiplier } from "../seasonality.js";
import { drawLegitOutcome } from "../outcomes.js";
import { isIncomeDay, drawIncomeAmount } from "../population/income-patterns.js";
import { drawDailyTransactionCount } from "../population/spend-rhythms.js";
import { drawMerchantAmount } from "../population/merchants.js";
import { drawTimeOfDay } from "./activity-curve.js";
import { drainDay, planDay } from "../fraud/planner.js";
import type { LabelRecord, TruthEvent } from "../types.js";
import { accumulateDay } from "../realism/aggregators.js";
import { recordPurchase, type PartitionWorld, type PurchaseRing } from "./partition-world.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DayOutput {
  /** Sorted by `ts`. */
  events: TruthEvent[];
  /** `labels[i].event_id === events[i].event_id`. */
  labels: LabelRecord[];
}

interface Item {
  ms: number;
  event: TruthEvent;
  label: LabelRecord;
}

function cleanLabel(eventId: string): LabelRecord {
  return {
    event_id: eventId,
    is_fraud: false,
    typology: null,
    actor_id: null,
    campaign_step: null,
    corruption_type: null,
    corruption_detail: null,
    sink: null,
    delivery_outcome: null,
  };
}

/** Expected number of legitimate events on a day — a closed-form function of the population,
 * the weekday rhythm and the seasonality multiplier, so the fraud planner never needs the
 * day's actual events first (R6). */
function expectedLegitCount(world: PartitionWorld, date: Date, seasonMultiplier: number): number {
  const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  const archetypes = world.spec.population.consumers.archetypes;
  let total = 0;
  for (let a = 0; a < archetypes.length; a++) {
    const archetype = archetypes[a]!;
    const rhythm = archetype.spend_rhythm;
    const spend =
      rhythm.daily_transaction_count_mean *
      (isWeekend ? rhythm.weekend_multiplier : 1) *
      seasonMultiplier;
    const income = archetype.income_pattern.kind === "fixed_credit_day" ? 1 / 30 : 1 / 7;
    total += world.archetypeCounts[a]! * (spend + income);
  }
  return total;
}

/**
 * Simulates one day of one partition's world (R6). A pure function of `(world state, dayIndex)`:
 * history days `0…D−1` followed by live days `D…` produce exactly what one uninterrupted
 * simulation would. Memory is one day of events plus the pending-fraud heap.
 */
export function simulateDay(world: PartitionWorld, dayIndex: number): DayOutput {
  if (dayIndex !== world.nextDayIndex) {
    throw new Error(`world is at day ${world.nextDayIndex}; cannot simulate day ${dayIndex}`);
  }
  const { spec, rng, consumers, merchants } = world;
  const clockStartMs = Date.parse(`${spec.clock.start}T00:00:00.000Z`);
  const dayStartMs = clockStartMs + dayIndex * DAY_MS;
  const dayEndMs = dayStartMs + DAY_MS;
  const date = new Date(dayStartMs);
  const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  const seasonMultiplier = seasonalityMultiplier(spec.seasonality, date);
  const archetypes = spec.population.consumers.archetypes;

  planDay(world, dayIndex, expectedLegitCount(world, date, seasonMultiplier));

  const items: Item[] = [];

  for (let index = 0; index < consumers.length; index++) {
    const consumer = consumers[index]!;
    const archetype = archetypes[consumer.archetypeIndex]!;
    if (consumer.dormantUntilMs !== null && consumer.dormantUntilMs <= dayStartMs) {
      consumer.dormantUntilMs = null;
      consumer.compromised = false;
    }
    const dormantUntil = consumer.dormantUntilMs;

    if (isIncomeDay(archetype.income_pattern, date, rng)) {
      const amount = drawIncomeAmount(archetype.income_pattern, rng);
      const tsMs = drawTimeOfDay(dayStartMs, rng);
      const status = drawLegitOutcome(spec.outcomes, rng);
      if (dormantUntil === null || tsMs >= dormantUntil) {
        const eventId = world.makeId(tsMs);
        items.push({
          ms: tsMs,
          label: cleanLabel(eventId),
          event: {
            event_id: eventId,
            ts: new Date(tsMs).toISOString(),
            type: "income_credit",
            status,
            amount,
            currency: spec.currency,
            consumer_id: consumer.id,
            consumer_name: consumer.name,
            merchant_id: null,
            merchant_name: null,
            counterparty_id: null,
            counterparty_name: null,
            channel: spec.channel,
            partition_no: world.partitionNo,
          },
        });
      }
    }

    const baseCount = drawDailyTransactionCount(archetype.spend_rhythm, isWeekend, rng);
    const txCount = Math.round(baseCount * seasonMultiplier);
    for (let t = 0; t < txCount; t++) {
      const merchantIndex = randInt(rng, 0, merchants.length);
      const merchant = merchants[merchantIndex];
      const category = merchant
        ? spec.population.merchants.categories[merchant.category]
        : undefined;
      if (!merchant || !category) continue;
      const amount = drawMerchantAmount(category, rng);
      const tsMs = drawTimeOfDay(dayStartMs, rng);
      const status = drawLegitOutcome(spec.outcomes, rng);
      if (dormantUntil !== null && tsMs < dormantUntil) continue;

      const eventId = world.makeId(tsMs);
      items.push({
        ms: tsMs,
        label: cleanLabel(eventId),
        event: {
          event_id: eventId,
          ts: new Date(tsMs).toISOString(),
          type: "payment",
          status,
          amount,
          currency: spec.currency,
          consumer_id: consumer.id,
          consumer_name: consumer.name,
          merchant_id: merchant.id,
          merchant_name: merchant.name,
          counterparty_id: null,
          counterparty_name: null,
          channel: spec.channel,
          partition_no: world.partitionNo,
        },
      });

      let ring: PurchaseRing | undefined = world.recentPurchases.get(index);
      if (!ring) {
        ring = { entries: [], head: 0 };
        world.recentPurchases.set(index, ring);
      }
      recordPurchase(ring, { eventId, amount, merchantIndex, tsMs });
    }
  }

  const legitCount = items.length;
  const fraud = drainDay(world, dayEndMs);
  for (let i = 0; i < fraud.events.length; i++) {
    const event = fraud.events[i]!;
    items.push({ ms: Date.parse(event.ts), event, label: fraud.labels[i]! });
  }

  items.sort((a, b) => a.ms - b.ms);
  const output: DayOutput = {
    events: items.map((item) => item.event),
    labels: items.map((item) => item.label),
  };

  world.planner.legitSeen += legitCount;
  accumulateDay(world.stats, output);
  world.nextDayIndex = dayIndex + 1;
  return output;
}
