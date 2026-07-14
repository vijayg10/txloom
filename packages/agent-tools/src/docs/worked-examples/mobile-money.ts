import type { SimulationSpec } from "@txloom/spec";

/** Mobile money — wallet top-ups, P2P transfers, and merchant bill pay. Uses
 * the en-IN name pack as the closest shipped locale until a dedicated pack
 * lands (community-contributable, see packages/engine/data/name-packs/). */
export const mobileMoneyWorkedExample: SimulationSpec = {
  seed: 20260303,
  currency: "INR",
  locale: "en-IN",
  channel: "mobile_money",
  clock: { start: "2026-01-01", days: 45, then_stream_tps: 20 },
  population: {
    consumers: {
      count: 8000,
      archetypes: [
        {
          name: "wallet_user",
          weight: 0.65,
          income_pattern: { kind: "irregular_weekly", amount_mean: 5000, amount_stddev: 2000 },
          spend_rhythm: {
            daily_transaction_count_mean: 2,
            daily_transaction_count_stddev: 1,
            weekend_multiplier: 1.2,
          },
        },
        {
          name: "agent_customer",
          weight: 0.35,
          income_pattern: {
            kind: "fixed_credit_day",
            day_of_month: 5,
            amount_mean: 15000,
            amount_stddev: 4000,
          },
          spend_rhythm: {
            daily_transaction_count_mean: 1.2,
            daily_transaction_count_stddev: 0.6,
            weekend_multiplier: 1.0,
          },
        },
      ],
    },
    merchants: {
      count: 200,
      categories: {
        airtime: {
          name: "airtime",
          weight: 0.4,
          amount_distribution: { kind: "exponential", mean: 100 },
        },
        bill_pay: {
          name: "bill_pay",
          weight: 0.35,
          amount_distribution: { kind: "lognormal", mean: 600, stddev: 300 },
        },
        grocery: {
          name: "grocery",
          weight: 0.25,
          amount_distribution: { kind: "lognormal", mean: 300, stddev: 120 },
        },
      },
    },
  },
  seasonality: [],
  fraud: {
    target_rate: 0.03,
    typologies: [
      { type: "account_takeover", share: 1, params: { dormancy_days: 20, drain_step_count: 5 } },
    ],
  },
  outcomes: { baseline_decline_rate: 0.04 },
  imperfections: {
    late_arrival: {
      rate: 0.05,
      delay_seconds_mean: 15,
      delay_seconds_stddev: 10,
      sinks: ["mm-webhook"],
    },
    out_of_order: { rate: 0.02, sinks: ["mm-webhook"] },
  },
  output: {
    sinks: [{ type: "webhook", name: "mm-webhook", format: "json" }],
    labels: "separate_export",
  },
};
