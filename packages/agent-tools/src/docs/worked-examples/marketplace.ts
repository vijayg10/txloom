import type { SimulationSpec } from "@txloom/spec";

/** Marketplace payouts — seller payments (modeled as p2p-style transfers from
 * the platform to sellers) plus buyer-side card payments. */
export const marketplaceWorkedExample: SimulationSpec = {
  seed: 20260404,
  currency: "USD",
  locale: "en-US",
  channel: "marketplace_payout",
  clock: { start: "2026-05-01", days: 60 },
  population: {
    consumers: {
      count: 2000,
      archetypes: [
        {
          name: "buyer",
          weight: 0.8,
          income_pattern: {
            kind: "fixed_credit_day",
            day_of_month: 1,
            amount_mean: 5000,
            amount_stddev: 1200,
          },
          spend_rhythm: {
            daily_transaction_count_mean: 0.8,
            daily_transaction_count_stddev: 0.5,
            weekend_multiplier: 1.8,
          },
        },
        {
          name: "power_seller",
          weight: 0.2,
          income_pattern: { kind: "irregular_weekly", amount_mean: 3000, amount_stddev: 1500 },
          spend_rhythm: {
            daily_transaction_count_mean: 0.3,
            daily_transaction_count_stddev: 0.2,
            weekend_multiplier: 1.0,
          },
        },
      ],
    },
    merchants: {
      count: 500,
      categories: {
        marketplace_seller: {
          name: "marketplace_seller",
          weight: 1,
          amount_distribution: { kind: "lognormal", mean: 80, stddev: 60 },
        },
      },
    },
  },
  seasonality: [
    { event: "holiday_shopping", window: ["2026-06-20", "2026-06-27"], volume_multiplier: 2.5 },
  ],
  fraud: {
    target_rate: 0.02,
    typologies: [
      { type: "refund_abuse", share: 1, params: { refund_rate: 0.35, max_refunds_per_actor: 6 } },
    ],
  },
  outcomes: { baseline_decline_rate: 0.025 },
  imperfections: {
    duplicate_delivery: { rate: 0.01, sinks: ["payout-export"] },
  },
  output: {
    sinks: [{ type: "file", name: "payout-export", format: "csv" }],
    labels: "separate_export",
  },
};
