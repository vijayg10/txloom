import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues } from "../../src/services/queues.js";

const validSpec = {
  seed: 1,
  currency: "INR",
  locale: "en-IN",
  channel: "upi",
  clock: { start: "2026-01-01", days: 7 },
  population: {
    consumers: {
      count: 5,
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

// Testcontainers MySQL + Redis — run launch/list/detail contract.
// Run via `pnpm test:integration` (requires a local Docker daemon).
describe("runs contract", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let scenarioId: string;

  beforeAll(async () => {
    [mysql, redis] = await Promise.all([
      new GenericContainer("mysql:8.4")
        .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
        .withExposedPorts(3306)
        .start(),
      new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
    ]);

    process.env.DATABASE_URL = `mysql://root:test@${mysql.getHost()}:${mysql.getMappedPort(3306)}/txloom_test`;
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    await getDb().migrate.latest();
    app = await buildApp();

    const scenarioResponse = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: "Runs test", currency: "INR" },
    });
    scenarioId = scenarioResponse.json().id;
    await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/versions`,
      payload: { spec: validSpec },
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
  });

  it("POST /scenarios/:id/runs launches a run and snapshots the spec", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("running");
    expect(body.spec_snapshot).toMatchObject({ seed: validSpec.seed });
  });

  it("GET /runs lists launched runs", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/runs" });
    expect(response.statusCode).toBe(200);
    expect(response.json().runs.length).toBeGreaterThan(0);
  });

  it("GET /runs/:id returns the immutable run record", async () => {
    const launch = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload: {},
    });
    const runId = launch.json().id;

    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(runId);
  });
});
