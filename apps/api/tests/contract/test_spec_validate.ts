import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

const validSpec = {
  seed: 1,
  currency: "INR",
  locale: "en-IN",
  channel: "upi",
  clock: { start: "2026-01-01", days: 30 },
  population: {
    consumers: {
      count: 10,
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
  output: { sinks: [{ type: "file", name: "primary", format: "csv" }], labels: "separate_export" },
};

describe("POST /spec/validate", () => {
  it("200s with valid:true for a valid spec, never 4xx (FR-038)", async () => {
    const app = await buildApp({ skipDb: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/spec/validate",
      payload: validSpec,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ valid: true, violations: [] });
    await app.close();
  });

  it("200s with located violations for an invalid spec (FR-004/010)", async () => {
    const app = await buildApp({ skipDb: true });
    const invalid = { ...validSpec, fraud: { target_rate: 5, typologies: [] } };
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/spec/validate",
      payload: invalid,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(false);
    expect(body.violations.length).toBeGreaterThan(0);
    expect(body.violations[0]).toHaveProperty("path");
    expect(body.violations[0]).toHaveProperty("code");
    expect(body.violations[0]).toHaveProperty("message");
    await app.close();
  });
});

describe("GET /spec/schema", () => {
  it("200s with the SimulationSpec JSON Schema", async () => {
    const app = await buildApp({ skipDb: true });
    const response = await app.inject({ method: "GET", url: "/api/v1/spec/schema" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.title).toBe("SimulationSpec");
    expect(body).toHaveProperty("properties");
    await app.close();
  });
});
