import type { SimulationSpec } from "@txloom/spec";
import { defaultPartitionCount } from "./partitioning.js";
import { seasonalityMultiplier } from "./seasonality.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunEstimate {
  /** Truth events the generator is expected to emit. */
  history_events: number;
  /** Messages sent to the spec's non-file sinks if the history is replayed, 0 otherwise. */
  replay_messages: number;
  partitions: number;
  generation_seconds: number;
  assumptions: string[];
}

export interface EstimateOptions {
  replayHistory: boolean;
  /** Events one generation thread produces per second. */
  throughputPerThread: number;
  /** Worker threads available to generation. */
  threads: number;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, absolute error < 1.5e-7). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Expected transactions for one consumer on one day, matching how `simulateDay` draws them:
 * `max(0, round(N(mean, stddev)))`, then `round(count × seasonality)`. The floor at zero makes
 * the expectation larger than the mean when the deviation is wide, so it is summed over the
 * integer outcomes rather than taken as `mean × multiplier`.
 */
function expectedDailyTransactions(mean: number, stddev: number, season: number): number {
  if (stddev <= 0) return Math.round(Math.max(0, Math.round(mean)) * season);
  const top = Math.ceil(mean + 8 * stddev) + 1;
  let expected = 0;
  let below = normalCdf((0.5 - mean) / stddev); // P(round(X) <= 0): all clamp to zero
  for (let k = 1; k <= top; k++) {
    const upTo = normalCdf((k + 0.5 - mean) / stddev);
    expected += (upTo - below) * Math.round(k * season);
    below = upTo;
  }
  return expected;
}

/** Probability that an `irregular_weekly` consumer receives income on a given day, and the
 * exact number of days a `fixed_credit_day` consumer does (the day of month recurs). */
function expectedIncomeEvents(
  pattern: SimulationSpec["population"]["consumers"]["archetypes"][number]["income_pattern"],
  startMs: number,
  days: number,
): number {
  if (pattern.kind === "irregular_weekly") return days / 7;
  let hits = 0;
  for (let d = 0; d < days; d++) {
    if (new Date(startMs + d * DAY_MS).getUTCDate() === pattern.day_of_month) hits++;
  }
  return hits;
}

/**
 * Fraction of consumer-days silenced by account-takeover dormancy. The planner picks a victim
 * on some day `p`, and the victim emits nothing until the takeover, whose day is drawn
 * uniformly from `[p + dormancy_days, days)`. Victims are planned evenly across the days.
 */
function dormantFraction(
  days: number,
  consumers: number,
  victims: number,
  dormancyDays: number,
): number {
  if (victims <= 0 || consumers <= 0 || days <= 0) return 0;
  const cappedVictims = Math.min(victims, consumers);
  let lostDays = 0;
  for (let p = 0; p < days; p++) {
    const earliest = Math.min(p + dormancyDays, days - 1);
    // randInt(earliest, days) averages (earliest + days - 1) / 2; the takeover lands in the
    // first half of its day.
    const meanAnchor = (earliest + days - 1) / 2 + 0.25;
    lostDays += Math.max(0, meanAnchor - p);
  }
  return Math.min(1, ((cappedVictims / days) * lostDays) / (consumers * days));
}

/**
 * Estimates a run's volume and duration from its spec alone (FR-045, research R16). A pure,
 * closed-form calculation over days and archetypes, with no generation, so it stays well under
 * a millisecond for the reference spec.
 */
export function estimateRun(spec: SimulationSpec, options: EstimateOptions): RunEstimate {
  const startMs = Date.parse(`${spec.clock.start}T00:00:00.000Z`);
  const days = spec.clock.days;
  const consumers = spec.population.consumers.count;
  const archetypes = spec.population.consumers.archetypes;
  const totalWeight = archetypes.reduce((sum, a) => sum + a.weight, 0) || 1;

  // The spending part depends only on the day's weekday/weekend and seasonality, so count how
  // many days fall in each bucket before doing any probability work.
  const buckets = new Map<string, { weekend: boolean; season: number; days: number }>();
  for (let d = 0; d < days; d++) {
    const date = new Date(startMs + d * DAY_MS);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const season = seasonalityMultiplier(spec.seasonality, date);
    const key = `${weekend ? 1 : 0}|${season}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.days++;
    else buckets.set(key, { weekend, season, days: 1 });
  }

  let legit = 0;
  for (const archetype of archetypes) {
    const members = (consumers * archetype.weight) / totalWeight;
    const rhythm = archetype.spend_rhythm;
    let perConsumer = expectedIncomeEvents(archetype.income_pattern, startMs, days);
    for (const bucket of buckets.values()) {
      const mean =
        rhythm.daily_transaction_count_mean * (bucket.weekend ? rhythm.weekend_multiplier : 1);
      perConsumer +=
        bucket.days *
        expectedDailyTransactions(mean, rhythm.daily_transaction_count_stddev, bucket.season);
    }
    legit += members * perConsumer;
  }

  // The fraud planner owes `rate / (1 − rate)` fraud events per legitimate one actually
  // generated, split across the typologies by share. Account-takeover victims go quiet until the
  // takeover, which lowers the legitimate volume the owed fraud is measured against, so the two
  // are settled together.
  const { target_rate: rate, typologies } = spec.fraud;
  const shareTotal = Math.min(
    1,
    typologies.reduce((sum, t) => sum + t.share, 0),
  );
  const owedPerLegit = rate > 0 && rate < 1 ? (rate / (1 - rate)) * shareTotal : 0;
  const takeover = typologies.find((t) => t.type === "account_takeover");
  let legitGenerated = legit;
  for (let pass = 0; pass < 6 && takeover && owedPerLegit > 0; pass++) {
    const takeoverEvents = legitGenerated * (rate / (1 - rate)) * takeover.share;
    const victims = takeoverEvents / Math.max(1, takeover.params.drain_step_count);
    legitGenerated =
      legit * (1 - dormantFraction(days, consumers, victims, takeover.params.dormancy_days));
  }
  const fraud = legitGenerated * owedPerLegit;
  const historyEvents = Math.round(legitGenerated + fraud);

  // Replay goes to every non-file sink; a sink targeted by the duplicate imperfection gets
  // `1 + rate` times the events.
  const duplicates = spec.imperfections.duplicate_delivery;
  let replayMessages = 0;
  if (options.replayHistory) {
    for (const sink of spec.output.sinks) {
      if (sink.type === "file") continue;
      const duplicated = duplicates && (!duplicates.sinks || duplicates.sinks.includes(sink.name));
      replayMessages += historyEvents * (1 + (duplicated ? duplicates.rate : 0));
    }
    replayMessages = Math.round(replayMessages);
  }

  const partitions = defaultPartitionCount(consumers);
  const usableThreads = Math.max(1, Math.min(partitions, options.threads));
  const generationSeconds = historyEvents / (options.throughputPerThread * usableThreads);

  const assumptions = [
    `${options.throughputPerThread.toLocaleString("en-US")} events/s per generation thread`,
    `${usableThreads} thread${usableThreads === 1 ? "" : "s"} in use (${partitions} partition${partitions === 1 ? "" : "s"})`,
    options.replayHistory
      ? "replays every history event to each broker destination"
      : "no replay (replay_history=false)",
  ];
  return {
    history_events: historyEvents,
    replay_messages: replayMessages,
    partitions,
    generation_seconds: generationSeconds,
    assumptions,
  };
}
