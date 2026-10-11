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
  /** Daily event counts (world-inspector's volume-over-time chart, FR-036 §4) —
   * mergeable the same way byTypology is: sum matching dates across partitions. */
  byDate: Record<string, number>;
  /** Amount moments grouped by event type (world-inspector's amount-distributions
   * chart, FR-036 §4) — mergeable with mergeAggregators per group. */
  amountByType: Record<string, Aggregator>;
  /** Event counts by UTC day-of-week × hour-of-day, keyed "`dow:hour`" (world-inspector's
   * persona-heatmap chart, FR-036 §4) — mergeable by summing matching keys. */
  byDowHour: Record<string, number>;
  /** Fraud event counts by day × typology, keyed "`date|typology`" (world-inspector's
   * fraud-timeline chart, FR-036 §4) — mergeable by summing matching keys. */
  byDateTypology: Record<string, number>;
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
    byDate: {},
    amountByType: {},
    byDowHour: {},
    byDateTypology: {},
    lastTsMs: null,
    fraudCount: 0,
  };
}

/** Folds one day's sorted events and aligned labels (row i of each is the same event,
 * per partition-worker.ts) into the running stats. */
export function accumulateDay(
  stats: PartitionStatsAccumulator,
  day: { events: readonly TruthEvent[]; labels: readonly LabelRecord[] },
): void {
  for (let i = 0; i < day.events.length; i++) {
    const event = day.events[i]!;
    addSample(stats.amount, event.amount);
    const typeAgg = stats.amountByType[event.type] ?? createAggregator();
    addSample(typeAgg, event.amount);
    stats.amountByType[event.type] = typeAgg;
    const date = event.ts.slice(0, 10);
    stats.byDate[date] = (stats.byDate[date] ?? 0) + 1;
    const d = new Date(event.ts);
    const dowHourKey = `${d.getUTCDay()}:${d.getUTCHours()}`;
    stats.byDowHour[dowHourKey] = (stats.byDowHour[dowHourKey] ?? 0) + 1;
    const ms = Date.parse(event.ts);
    if (stats.lastTsMs !== null) addSample(stats.interArrivalMs, ms - stats.lastTsMs);
    stats.lastTsMs = ms;

    const label = day.labels[i];
    if (label?.is_fraud && label.typology) {
      stats.byTypology[label.typology] = (stats.byTypology[label.typology] ?? 0) + 1;
      stats.fraudCount++;
      const dateTypologyKey = `${date}|${label.typology}`;
      stats.byDateTypology[dateTypologyKey] = (stats.byDateTypology[dateTypologyKey] ?? 0) + 1;
    }
  }
  stats.eventCount += day.events.length;
}

/** The serializable part of the accumulator, as written to `part-<n>.stats.json`. */
export function toRealismStats(stats: PartitionStatsAccumulator): PartitionRealismStats {
  return {
    eventCount: stats.eventCount,
    amount: stats.amount,
    interArrivalMs: stats.interArrivalMs,
    byTypology: stats.byTypology,
    byDate: stats.byDate,
    amountByType: stats.amountByType,
    byDowHour: stats.byDowHour,
    byDateTypology: stats.byDateTypology,
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
