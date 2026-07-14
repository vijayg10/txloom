import {
  createAggregator,
  mergeAggregators,
  stddev,
  type PartitionRealismStats,
} from "./aggregators.js";

export interface RealismReport {
  event_count: number;
  amount: { mean: number; stddev: number; min: number; max: number };
  inter_arrival_ms: { mean: number; stddev: number };
  fraud: { achieved_rate: number; by_typology: Record<string, number> };
  benchmark_comparison: Record<string, unknown> | null;
}

/** Merges every partition's streaming aggregates into the run-level report
 * (D17) and compares against the template's sourced benchmark_refs, if any. */
export function mergeRealismReport(
  partitionStats: readonly PartitionRealismStats[],
  benchmarkRefs: Record<string, unknown> | null = null,
): RealismReport {
  let amount = createAggregator();
  let interArrivalMs = createAggregator();
  let eventCount = 0;
  const byTypology: Record<string, number> = {};

  for (const stats of partitionStats) {
    amount = mergeAggregators(amount, stats.amount);
    interArrivalMs = mergeAggregators(interArrivalMs, stats.interArrivalMs);
    eventCount += stats.eventCount;
    for (const [typology, count] of Object.entries(stats.byTypology)) {
      byTypology[typology] = (byTypology[typology] ?? 0) + count;
    }
  }

  const fraudCount = Object.values(byTypology).reduce((sum, n) => sum + n, 0);

  return {
    event_count: eventCount,
    amount: {
      mean: amount.mean,
      stddev: stddev(amount),
      min: amount.min === Infinity ? 0 : amount.min,
      max: amount.max === -Infinity ? 0 : amount.max,
    },
    inter_arrival_ms: { mean: interArrivalMs.mean, stddev: stddev(interArrivalMs) },
    fraud: { achieved_rate: eventCount > 0 ? fraudCount / eventCount : 0, by_typology: byTypology },
    benchmark_comparison: benchmarkRefs,
  };
}
