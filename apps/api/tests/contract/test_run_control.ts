import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues } from "../../src/services/queues.js";
import { ScenarioRepository } from "../../src/db/repositories/scenarios.js";
import { SpecVersionRepository } from "../../src/db/repositories/spec-versions.js";
import { RunRepository } from "../../src/db/repositories/runs.js";

const spec = {
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

// Testcontainers MySQL + Redis — run pause/resume/cancel/regenerate,
// DELETE .../outputs. Run via `pnpm test:integration`.
describe("run control contract", () => {
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

    const db = getDb();
    const scenarios = new ScenarioRepository(db);
    const versions = new SpecVersionRepository(db);
    const scenario = await scenarios.create({ name: "Run control test", currency: "INR" });
    const version = await versions.create({ scenario_id: scenario.id, spec, author_type: "user" });
    await scenarios.setCurrentVersion(scenario.id, version.id);
    scenarioId = scenario.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
  });

  async function launchRun(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload: {},
    });
    return response.json().id as string;
  }

  it("pauses a running run, then rejects a second pause (invalid state)", async () => {
    const runId = await launchRun();

    const pauseResponse = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/pause` });
    expect(pauseResponse.statusCode).toBe(200);
    expect(pauseResponse.json().status).toBe("paused");

    const secondPause = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/pause` });
    expect(secondPause.statusCode).toBe(409);
  });

  it("resumes a paused run back to running", async () => {
    const runId = await launchRun();
    await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/pause` });

    const resumeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/resume`,
    });
    expect(resumeResponse.statusCode).toBe(200);
    expect(resumeResponse.json().status).toBe("running");
  });

  it("cancels a run", async () => {
    const runId = await launchRun();
    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/cancel`,
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().status).toBe("cancelled");
  });

  it("regenerates a run from its stored snapshot+seed", async () => {
    const runId = await launchRun();
    const runRepo = new RunRepository(getDb());
    const original = await runRepo.getById(runId);

    const regenerateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/regenerate`,
    });
    expect(regenerateResponse.statusCode).toBe(201);
    const regenerated = regenerateResponse.json();
    expect(regenerated.id).not.toBe(runId);
    expect(regenerated.seed).toBe(original!.seed);
    expect(regenerated.spec_snapshot).toEqual(original!.spec_snapshot);
  });

  it("DELETE .../outputs stamps outputs_deleted_at and keeps the run row", async () => {
    const runId = await launchRun();
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/runs/${runId}/outputs`,
    });
    expect(deleteResponse.statusCode).toBe(204);

    const runRepo = new RunRepository(getDb());
    const run = await runRepo.getById(runId);
    expect(run).toBeDefined();
    expect(run!.outputs_deleted_at).not.toBeNull();
  });
});
