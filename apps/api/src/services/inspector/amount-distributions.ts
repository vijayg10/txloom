import type { TruthEvent } from "@txloom/engine";
import { createAggregator, addSample, stddev, type Aggregator } from "@txloom/engine";

export interface AmountDistributionBucket {
  group: string;
  count: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

/**
 * Amount distribution grouped by event type (payment/p2p_transfer/
 * income_credit/refund) — the dimension TruthEvent actually carries. A
 * merchant-category breakdown needs a per-run merchant catalog persisted
 * alongside the truth store, which v1 doesn't keep (merchants are generated
 * in-memory at launch); documented follow-up.
 */
export function computeAmountDistributions(
  events: readonly TruthEvent[],
): AmountDistributionBucket[] {
  const byGroup = new Map<string, Aggregator>();
  for (const event of events) {
    const agg = byGroup.get(event.type) ?? createAggregator();
    addSample(agg, event.amount);
    byGroup.set(event.type, agg);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, agg]) => ({
      group,
      count: agg.count,
      mean: agg.mean,
      stddev: stddev(agg),
      min: agg.min === Infinity ? 0 : agg.min,
      max: agg.max === -Infinity ? 0 : agg.max,
    }));
}
