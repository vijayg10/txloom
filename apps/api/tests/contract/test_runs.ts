import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { ENGINE_VERSION } from "@txloom/engine";
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

  async function launch(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload,
    });
  }

  it("round-trips a 64-bit string seed exactly", async () => {
    const response = await launch({ seed: "18446744073709551615" });
    expect(response.statusCode).toBe(201);
    expect(response.json().seed).toBe("18446744073709551615");

    const read = await app.inject({ method: "GET", url: `/api/v1/runs/${response.json().id}` });
    expect(read.json().seed).toBe("18446744073709551615");
  });

  it.each([
    ["a JSON number above 2^53", 2 ** 53 + 2],
    ["a negative string", "-1"],
    ["a string above 2^64-1", "18446744073709551616"],
    ["a non-numeric string", "2^64"],
  ])("rejects %s with invalid_seed and states the range", async (_label, seed) => {
    const response = await launch({ seed });
    expect(response.statusCode).toBe(400);
    const { error } = response.json();
    expect(error.code).toBe("invalid_seed");
    expect(error.message).toContain("18446744073709551615");
  });

  it("GET /runs/:id includes engine_version and partition_count", async () => {
    const launched = await launch({});
    const read = await app.inject({ method: "GET", url: `/api/v1/runs/${launched.json().id}` });
    const body = read.json();
    expect(body.engine_version).toBe(ENGINE_VERSION);
    expect(body.partition_count).toBe(1);
  });

  it("a launch with no seed uses spec.seed, and a request seed overrides it", async () => {
    const first = (await launch({})).json();
    const second = (await launch({})).json();
    expect(first.seed).toBe(String(validSpec.seed));
    expect(second.seed).toBe(first.seed);

    const overridden = (await launch({ seed: "42" })).json();
    expect(overridden.seed).toBe("42");
  });

  it("GET /runs items include scenario.name and spec_version.number", async () => {
    const launched = (await launch({})).json();
    const list = (await app.inject({ method: "GET", url: "/api/v1/runs" })).json().runs as {
      id: string;
      scenario: { id: string; name: string };
      spec_version: { id: string; number: number };
    }[];
    const item = list.find((run) => run.id === launched.id)!;
    expect(item.scenario).toEqual({ id: scenarioId, name: "Runs test" });
    expect(item.spec_version.number).toBeGreaterThanOrEqual(1);
    expect(typeof item.spec_version.id).toBe("string");
  });

  it("GET /runs/:id has the same scenario and version, and the immutable launch_destinations", async () => {
    const launched = (await launch({})).json();
    const body = (await app.inject({ method: "GET", url: `/api/v1/runs/${launched.id}` })).json();
    expect(body.scenario.name).toBe("Runs test");
    expect(body.spec_version.number).toBeGreaterThanOrEqual(1);
    expect(body.launch_destinations).toEqual([]);
  });

  it("reports the run's phase, so the run page can follow it", async () => {
    const launched = (await launch({})).json();
    const running = (
      await app.inject({ method: "GET", url: `/api/v1/runs/${launched.id}` })
    ).json();
    expect(running.phase).toBe("generating");

    await getDb()("runs").where({ id: launched.id }).update({ status: "completed" });
    const done = (await app.inject({ method: "GET", url: `/api/v1/runs/${launched.id}` })).json();
    expect(done.phase).toBe("done");
    const listed = (await app.inject({ method: "GET", url: "/api/v1/runs" })).json().runs as {
      id: string;
      phase: string;
    }[];
    expect(listed.find((r) => r.id === launched.id)?.phase).toBe("done");
  });
});
