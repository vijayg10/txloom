import type { SimulationSpec } from "@txloom/spec";

/** Small, fast reference scenario for golden-master/property tests — full
 * behavioral coverage (income, seasonality, all 3 typologies, all 4
 * imperfections) at a scale that keeps the suite fast. */
export function referenceScenarioSpec(): SimulationSpec {
  return {
    seed: 42,
    currency: "INR",
    locale: "en-IN",
    channel: "upi",
    clock: { start: "2026-01-01", days: 14 },
    population: {
      consumers: {
        count: 50,
        archetypes: [
          {
            name: "salaried",
            weight: 0.6,
            income_pattern: {
              kind: "fixed_credit_day",
              day_of_month: 1,
              amount_mean: 50000,
              amount_stddev: 5000,
            },
            spend_rhythm: {
              daily_transaction_count_mean: 2,
              daily_transaction_count_stddev: 1,
              weekend_multiplier: 1.5,
            },
          },
          {
            name: "gig_worker",
            weight: 0.4,
            income_pattern: { kind: "irregular_weekly", amount_mean: 8000, amount_stddev: 2000 },
            spend_rhythm: {
              daily_transaction_count_mean: 3,
              daily_transaction_count_stddev: 1.5,
              weekend_multiplier: 1.2,
            },
          },
        ],
      },
      merchants: {
        count: 10,
        categories: {
          grocery: {
            name: "grocery",
            weight: 0.5,
            amount_distribution: { kind: "lognormal", mean: 500, stddev: 200 },
          },
          electronics: {
            name: "electronics",
            weight: 0.5,
            amount_distribution: { kind: "lognormal", mean: 5000, stddev: 2000 },
          },
        },
      },
    },
    seasonality: [{ event: "diwali", window: ["2026-01-05", "2026-01-07"], volume_multiplier: 2 }],
    fraud: {
      target_rate: 0.05,
      typologies: [
        {
          type: "card_testing",
          share: 0.5,
          params: {
            burst_size_min: 3,
            burst_size_max: 6,
            burst_window_minutes: 5,
            amount_min: 1,
            amount_max: 50,
          },
        },
        { type: "account_takeover", share: 0.3, params: { dormancy_days: 5, drain_step_count: 3 } },
        {
          type: "refund_abuse",
          share: 0.2,
          params: { refund_rate: 0.3, max_refunds_per_actor: 3 },
        },
      ],
    },
    outcomes: { baseline_decline_rate: 0.03 },
    imperfections: {
      duplicate_delivery: { rate: 0.02, sinks: ["primary-file"] },
      late_arrival: {
        rate: 0.05,
        delay_seconds_mean: 30,
        delay_seconds_stddev: 10,
        sinks: ["primary-file"],
      },
      out_of_order: { rate: 0.02, sinks: ["primary-file"] },
      clock_skew: { rate: 0.02, sources: [{ source: "primary-file", offset_seconds: 60 }] },
    },
    output: {
      sinks: [{ type: "file", name: "primary-file", format: "csv" }],
      labels: "separate_export",
    },
  };
}
