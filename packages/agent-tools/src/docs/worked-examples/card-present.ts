import type { SimulationSpec } from "@txloom/spec";

/** Card-present retail (US) — POS-style swipe/tap transactions. */
export const cardPresentWorkedExample: SimulationSpec = {
  seed: 20260202,
  currency: "USD",
  locale: "en-US",
  channel: "card_present",
  clock: { start: "2026-03-01", days: 60 },
  population: {
    consumers: {
      count: 3000,
      archetypes: [
        {
          name: "regular_shopper",
          weight: 0.7,
          income_pattern: {
            kind: "fixed_credit_day",
            day_of_month: 15,
            amount_mean: 4500,
            amount_stddev: 900,
          },
          spend_rhythm: {
            daily_transaction_count_mean: 1.5,
            daily_transaction_count_stddev: 0.8,
            weekend_multiplier: 1.6,
          },
        },
        {
          name: "frequent_shopper",
          weight: 0.3,
          income_pattern: { kind: "irregular_weekly", amount_mean: 1200, amount_stddev: 400 },
          spend_rhythm: {
            daily_transaction_count_mean: 3,
            daily_transaction_count_stddev: 1.5,
            weekend_multiplier: 1.3,
          },
        },
      ],
    },
    merchants: {
      count: 150,
      categories: {
        grocery: {
          name: "grocery",
          weight: 0.4,
          amount_distribution: { kind: "lognormal", mean: 65, stddev: 25 },
        },
        electronics: {
          name: "electronics",
          weight: 0.1,
          amount_distribution: { kind: "lognormal", mean: 250, stddev: 180 },
        },
        apparel: {
          name: "apparel",
          weight: 0.3,
          amount_distribution: { kind: "lognormal", mean: 55, stddev: 30 },
        },
        fuel: {
          name: "fuel",
          weight: 0.2,
          amount_distribution: { kind: "normal", mean: 45, stddev: 15 },
        },
      },
    },
  },
  seasonality: [
    { event: "black_friday", window: ["2026-04-27", "2026-04-28"], volume_multiplier: 3 },
  ],
  fraud: {
    target_rate: 0.01,
    typologies: [
      {
        type: "card_testing",
        share: 0.7,
        params: {
          burst_size_min: 4,
          burst_size_max: 10,
          burst_window_minutes: 3,
          amount_min: 0.5,
          amount_max: 5,
        },
      },
      { type: "refund_abuse", share: 0.3, params: { refund_rate: 0.2, max_refunds_per_actor: 3 } },
    ],
  },
  outcomes: { baseline_decline_rate: 0.015 },
  imperfections: {
    duplicate_delivery: { rate: 0.005, sinks: ["pos-files"] },
    late_arrival: {
      rate: 0.02,
      delay_seconds_mean: 60,
      delay_seconds_stddev: 20,
      sinks: ["pos-files"],
    },
  },
  output: {
    sinks: [{ type: "file", name: "pos-files", format: "parquet" }],
    labels: "separate_export",
  },
};
