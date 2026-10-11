import {
  createAggregator,
  mergeAggregators,
  stddev,
  type Aggregator,
  type PartitionRealismStats,
} from "./aggregators.js";

export interface RealismReport {
  event_count: number;
  amount: { mean: number; stddev: number; min: number; max: number };
  inter_arrival_ms: { mean: number; stddev: number };
  fraud: { achieved_rate: number; by_typology: Record<string, number> };
  benchmark_comparison: Record<string, unknown> | null;
  /** Daily event counts, sorted — the world-inspector volume-over-time chart
   * reads this instead of re-scanning the truth store (FR-036 §4, D17). */
  volume_over_time: { date: string; count: number }[];
  /** Amount moments per event type, sorted by group — the world-inspector
   * amount-distributions chart reads this instead of re-scanning (FR-036 §4, D17). */
  amount_by_type: { group: string; count: number; mean: number; stddev: number; min: number; max: number }[];
  /** Full 7×24 day-of-week × hour-of-day grid (UTC, zero-filled) — the world-inspector
   * persona-heatmap chart reads this instead of re-scanning (FR-036 §4, D17). */
  persona_heatmap: { dayOfWeek: number; hourOfDay: number; count: number }[];
  /** Daily fraud-event counts per typology, sorted — the world-inspector fraud-timeline
   * chart reads this instead of re-scanning (FR-036 §4, D17). */
  fraud_timeline: { date: string; typology: string; count: number }[];
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
  const byDate: Record<string, number> = {};
  const amountByType: Record<string, Aggregator> = {};
  const byDowHour: Record<string, number> = {};
  const byDateTypology: Record<string, number> = {};

  for (const stats of partitionStats) {
    amount = mergeAggregators(amount, stats.amount);
    interArrivalMs = mergeAggregators(interArrivalMs, stats.interArrivalMs);
    eventCount += stats.eventCount;
    for (const [typology, count] of Object.entries(stats.byTypology)) {
      byTypology[typology] = (byTypology[typology] ?? 0) + count;
    }
    for (const [date, count] of Object.entries(stats.byDate)) {
      byDate[date] = (byDate[date] ?? 0) + count;
    }
    for (const [type, agg] of Object.entries(stats.amountByType)) {
      amountByType[type] = mergeAggregators(amountByType[type] ?? createAggregator(), agg);
    }
    for (const [key, count] of Object.entries(stats.byDowHour)) {
      byDowHour[key] = (byDowHour[key] ?? 0) + count;
    }
    for (const [key, count] of Object.entries(stats.byDateTypology)) {
      byDateTypology[key] = (byDateTypology[key] ?? 0) + count;
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
    volume_over_time: Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
    amount_by_type: Object.entries(amountByType)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, agg]) => ({
        group,
        count: agg.count,
        mean: agg.mean,
        stddev: stddev(agg),
        min: agg.min === Infinity ? 0 : agg.min,
        max: agg.max === -Infinity ? 0 : agg.max,
      })),
    persona_heatmap: Array.from({ length: 7 }, (_, dayOfWeek) =>
      Array.from({ length: 24 }, (_, hourOfDay) => ({
        dayOfWeek,
        hourOfDay,
        count: byDowHour[`${dayOfWeek}:${hourOfDay}`] ?? 0,
      })),
    ).flat(),
    fraud_timeline: Object.entries(byDateTypology)
      .map(([key, count]) => {
        const [date, typology] = key.split("|") as [string, string];
        return { date, typology, count };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.typology.localeCompare(b.typology)),
  };
}
