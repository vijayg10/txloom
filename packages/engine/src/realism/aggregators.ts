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

/** Computes one partition's realism aggregates in a single pass over its own
 * events — never a second scan of the truth store (D17). */
export function computePartitionStats(
  events: readonly TruthEvent[],
  labels: readonly LabelRecord[],
): PartitionRealismStats {
  const amount = createAggregator();
  const interArrivalMs = createAggregator();
  const byTypology: Record<string, number> = {};

  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  let prevMs: number | null = null;
  for (const event of sorted) {
    addSample(amount, event.amount);
    const ms = Date.parse(event.ts);
    if (prevMs !== null) addSample(interArrivalMs, ms - prevMs);
    prevMs = ms;
  }

  for (const label of labels) {
    if (label.is_fraud && label.typology) {
      byTypology[label.typology] = (byTypology[label.typology] ?? 0) + 1;
    }
  }

  return { eventCount: events.length, amount, interArrivalMs, byTypology };
}
