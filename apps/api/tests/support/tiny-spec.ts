/** A valid spec small enough that tests never wait on generation. */
export function tinySpec(overrides: { consumers?: number; days?: number; seed?: number } = {}) {
  return {
    seed: overrides.seed ?? 1,
    currency: "INR",
    locale: "en-IN",
    channel: "upi",
    clock: { start: "2026-01-01", days: overrides.days ?? 3, then_stream_tps: 20 },
    population: {
      consumers: {
        count: overrides.consumers ?? 5,
        archetypes: [
          {
            name: "salaried",
            weight: 1,
            income_pattern: {
              kind: "fixed_credit_day",
              day_of_month: 1,
              amount_mean: 50000,
              amount_stddev: 5000,
            },
            spend_rhythm: {
              daily_transaction_count_mean: 2,
              daily_transaction_count_stddev: 1,
              weekend_multiplier: 1.2,
            },
          },
        ],
      },
      merchants: {
        count: 2,
        categories: {
          grocery: {
            name: "grocery",
            weight: 1,
            amount_distribution: { kind: "lognormal", mean: 500, stddev: 100 },
          },
        },
      },
    },
    seasonality: [],
    fraud: { target_rate: 0.01, typologies: [] },
    outcomes: { baseline_decline_rate: 0.02 },
    imperfections: {},
    output: {
      sinks: [{ type: "file", name: "primary", format: "csv" }],
      labels: "separate_export",
    },
  };
}
