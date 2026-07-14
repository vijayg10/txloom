import type { SimulationSpec } from "@txloom/spec";
import { derivePartitionRng, deriveNamedRng, type Rng } from "./rng.js";
import { createDeterministicUlid } from "./id.js";
import { computeConsumerPartitions } from "./partitioning.js";
import { sampleConsumers } from "./population/consumer-archetypes.js";
import { sampleMerchants, drawMerchantAmount } from "./population/merchants.js";
import { isIncomeDay, drawIncomeAmount } from "./population/income-patterns.js";
import { drawDailyTransactionCount } from "./population/spend-rhythms.js";
import { loadNamePack } from "./naming/pack-loader.js";
import { drawPersonName, drawMerchantName } from "./naming/assign-names.js";
import { seasonalityMultiplier } from "./seasonality.js";
import { drawLegitOutcome } from "./outcomes.js";
import { orchestrateFraud } from "./fraud/orchestrator.js";
import { randInt } from "./distributions.js";
import type { NamedConsumer, NamedMerchant } from "./population/named-population.js";
import type { LabelRecord, TruthEvent } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PartitionGenerationResult {
  truthEvents: TruthEvent[];
  labelRecords: LabelRecord[];
  achievedFraudRate: number;
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
 * Generates one partition's slice of the persona space end to end: consumers,
 * names, daily transactions (income + spend, seasonality-scaled), fraud
 * campaigns woven in, and outcome statuses — the deterministic core (FR-013,
 * FR-017/020, FR-014a). Truth events come back chronologically sorted.
 */
export function generatePartition(
  spec: SimulationSpec,
  seed: bigint,
  partitionNo: number,
  partitionCount: number,
  merchants: readonly NamedMerchant[],
): PartitionGenerationResult {
  const range = computeConsumerPartitions(spec.population.consumers.count, partitionCount)[
    partitionNo
  ];
  if (!range)
    throw new Error(`partitionNo ${partitionNo} out of range for partitionCount ${partitionCount}`);

  const rng: Rng = derivePartitionRng(seed, partitionNo);
  const pack = loadNamePack(spec.locale);
  const makeId = createDeterministicUlid(rng);

  const rawConsumers = sampleConsumers(
    spec.population.consumers.archetypes,
    range.start,
    range.end,
    rng,
  );
  const consumers: NamedConsumer[] = rawConsumers.map((c) => ({
    ...c,
    name: drawPersonName(pack, rng),
  }));

  const clockStartMs = Date.parse(`${spec.clock.start}T00:00:00.000Z`);
  const legitEvents: TruthEvent[] = [];

  for (let day = 0; day < spec.clock.days; day++) {
    const dayStartMs = clockStartMs + day * DAY_MS;
    const date = new Date(dayStartMs);
    const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const seasonMultiplier = seasonalityMultiplier(spec.seasonality, date);

    for (const consumer of consumers) {
      if (isIncomeDay(consumer.archetype.income_pattern, date, rng)) {
        const amount = drawIncomeAmount(consumer.archetype.income_pattern, rng);
        const tsMs = dayStartMs + randInt(rng, 0, DAY_MS);
        legitEvents.push({
          event_id: makeId(tsMs),
          ts: new Date(tsMs).toISOString(),
          type: "income_credit",
          status: drawLegitOutcome(spec.outcomes, rng),
          amount,
          currency: spec.currency,
          consumer_id: consumer.id,
          consumer_name: consumer.name,
          merchant_id: null,
          merchant_name: null,
          counterparty_id: null,
          counterparty_name: null,
          channel: spec.channel,
          partition_no: partitionNo,
        });
      }

      const baseCount = drawDailyTransactionCount(consumer.archetype.spend_rhythm, isWeekend, rng);
      const txCount = Math.round(baseCount * seasonMultiplier);
      for (let t = 0; t < txCount; t++) {
        const merchant = merchants[randInt(rng, 0, merchants.length)];
        if (!merchant) continue;
        const category = spec.population.merchants.categories[merchant.category];
        if (!category) continue;
        const amount = drawMerchantAmount(category, rng);
        const tsMs = dayStartMs + randInt(rng, 0, DAY_MS);
        legitEvents.push({
          event_id: makeId(tsMs),
          ts: new Date(tsMs).toISOString(),
          type: "payment",
          status: drawLegitOutcome(spec.outcomes, rng),
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
        });
      }
    }
  }

  legitEvents.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const fraudResult = orchestrateFraud({
    fraudConfig: spec.fraud,
    legitEvents,
    consumers,
    merchants,
    currency: spec.currency,
    channel: spec.channel,
    clockStartMs,
    clockDays: spec.clock.days,
    partitionNo,
    rng,
    makeId,
  });

  const legitLabels: LabelRecord[] = legitEvents.map((event) => ({
    event_id: event.event_id,
    is_fraud: false,
    typology: null,
    actor_id: null,
    campaign_step: null,
    corruption_type: null,
    corruption_detail: null,
    sink: null,
  }));

  const truthEvents = [...legitEvents, ...fraudResult.fraudEvents].sort(
    (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
  );
  const labelRecords = [...legitLabels, ...fraudResult.fraudLabels];

  return { truthEvents, labelRecords, achievedFraudRate: fraudResult.achievedRate };
}
