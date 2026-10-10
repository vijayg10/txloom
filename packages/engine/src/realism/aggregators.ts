import type { LabelRecord, TruthEvent } from "../types.js";

/** Welford's streaming mean/variance — mergeable across partitions without a
 * second pass over the data (D17). Quantiles are approximated from min/mean/
 * stddev in the report for v1; a true t-digest sketch is a documented follow-up. */
export interface Aggregator {
  count: number;
  mean: number;
  m2: number;
  min: number;
  max: number;
}

export function createAggregator(): Aggregator {
  return { count: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity };
}

export function addSample(agg: Aggregator, value: number): void {
  agg.count++;
  const delta = value - agg.mean;
  agg.mean += delta / agg.count;
  const delta2 = value - agg.mean;
  agg.m2 += delta * delta2;
  agg.min = Math.min(agg.min, value);
  agg.max = Math.max(agg.max, value);
}

export function variance(agg: Aggregator): number {
  return agg.count > 1 ? agg.m2 / (agg.count - 1) : 0;
}

export function stddev(agg: Aggregator): number {
  return Math.sqrt(variance(agg));
}

export function mergeAggregators(a: Aggregator, b: Aggregator): Aggregator {
  if (a.count === 0) return { ...b };
  if (b.count === 0) return { ...a };
  const count = a.count + b.count;
  const delta = b.mean - a.mean;
  const mean = a.mean + delta * (b.count / count);
  const m2 = a.m2 + b.m2 + (delta * delta * a.count * b.count) / count;
  return { count, mean, m2, min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
}

export interface PartitionRealismStats {
  eventCount: number;
  amount: Aggregator;
  interArrivalMs: Aggregator;
  byTypology: Record<string, number>;
}

/** Running realism aggregates for one partition, fed one simulated day at a time (R6) so
 * the full event array never has to exist. Days arrive in order and each day's events are
 * sorted, so inter-arrival gaps need only the previous event's timestamp. */
export interface PartitionStatsAccumulator extends PartitionRealismStats {
  lastTsMs: number | null;
  fraudCount: number;
}

export function createStatsAccumulator(): PartitionStatsAccumulator {
  return {
    eventCount: 0,
    amount: createAggregator(),
    interArrivalMs: createAggregator(),
    byTypology: {},
    lastTsMs: null,
    fraudCount: 0,
  };
}

/** Folds one day's sorted events and aligned labels into the running stats. */
export function accumulateDay(
  stats: PartitionStatsAccumulator,
  day: { events: readonly TruthEvent[]; labels: readonly LabelRecord[] },
): void {
  for (const event of day.events) {
    addSample(stats.amount, event.amount);
    const ms = Date.parse(event.ts);
    if (stats.lastTsMs !== null) addSample(stats.interArrivalMs, ms - stats.lastTsMs);
    stats.lastTsMs = ms;
  }
  stats.eventCount += day.events.length;
  for (const label of day.labels) {
    if (label.is_fraud && label.typology) {
      stats.byTypology[label.typology] = (stats.byTypology[label.typology] ?? 0) + 1;
      stats.fraudCount++;
    }
  }
}

/** The serializable part of the accumulator, as written to `part-<n>.stats.json`. */
export function toRealismStats(stats: PartitionStatsAccumulator): PartitionRealismStats {
  return {
    eventCount: stats.eventCount,
    amount: stats.amount,
    interArrivalMs: stats.interArrivalMs,
    byTypology: stats.byTypology,
  };
}

/** One-shot stats over an already-sorted event array (tests, small tools). */
export function computePartitionStats(
  events: readonly TruthEvent[],
  labels: readonly LabelRecord[],
): PartitionRealismStats {
  const stats = createStatsAccumulator();
  accumulateDay(stats, { events, labels });
  return toRealismStats(stats);
}
