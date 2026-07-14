import type { SimulationSpec } from "@txloom/spec";

/** UPI-style instant payments (India) — the flagship gallery template. */
export const upiWorkedExample: SimulationSpec = {
  seed: 20260101,
  currency: "INR",
  locale: "en-IN",
  channel: "upi",
  clock: { start: "2026-01-01", days: 90, then_stream_tps: 50 },
  population: {
    consumers: {
      count: 5000,
      archetypes: [
        {
          name: "salaried",
          weight: 0.55,
          income_pattern: {
            kind: "fixed_credit_day",
            day_of_month: 1,
            amount_mean: 60000,
            amount_stddev: 15000,
          },
          spend_rhythm: {
            daily_transaction_count_mean: 2.5,
            daily_transaction_count_stddev: 1.2,
            weekend_multiplier: 1.4,
          },
        },
        {
          name: "gig_worker",
          weight: 0.45,
          income_pattern: { kind: "irregular_weekly", amount_mean: 9000, amount_stddev: 3000 },
          spend_rhythm: {
            daily_transaction_count_mean: 3.5,
            daily_transaction_count_stddev: 1.5,
            weekend_multiplier: 1.1,
          },
        },
      ],
    },
    merchants: {
      count: 400,
      categories: {
        grocery: {
          name: "grocery",
          weight: 0.35,
          amount_distribution: { kind: "lognormal", mean: 400, stddev: 150 },
        },
        electronics: {
          name: "electronics",
          weight: 0.15,
          amount_distribution: { kind: "lognormal", mean: 4000, stddev: 2500 },
        },
        restaurant: {
          name: "restaurant",
          weight: 0.3,
          amount_distribution: { kind: "lognormal", mean: 350, stddev: 200 },
        },
        fuel: {
          name: "fuel",
          weight: 0.2,
          amount_distribution: { kind: "normal", mean: 800, stddev: 300 },
        },
      },
    },
  },
  seasonality: [{ event: "diwali", window: ["2026-02-10", "2026-02-17"], volume_multiplier: 2.2 }],
  fraud: {
    target_rate: 0.015,
    typologies: [
      {
        type: "card_testing",
        share: 0.4,
        params: {
          burst_size_min: 3,
          burst_size_max: 8,
          burst_window_minutes: 4,
          amount_min: 1,
          amount_max: 25,
        },
      },
      { type: "account_takeover", share: 0.4, params: { dormancy_days: 45, drain_step_count: 4 } },
      { type: "refund_abuse", share: 0.2, params: { refund_rate: 0.25, max_refunds_per_actor: 4 } },
    ],
  },
  outcomes: { baseline_decline_rate: 0.02 },
  imperfections: {
    duplicate_delivery: { rate: 0.01, sinks: ["upi-stream"] },
    late_arrival: {
      rate: 0.03,
      delay_seconds_mean: 20,
      delay_seconds_stddev: 8,
      sinks: ["upi-stream"],
    },
    out_of_order: { rate: 0.01, sinks: ["upi-stream"] },
    clock_skew: { rate: 0.01, sources: [{ source: "upi-stream", offset_seconds: 45 }] },
  },
  output: {
    sinks: [{ type: "kafka", name: "upi-stream", format: "json" }],
    labels: "separate_export",
  },
};
