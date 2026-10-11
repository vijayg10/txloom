import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues } from "../../src/services/queues.js";
import { ScenarioRepository } from "../../src/db/repositories/scenarios.js";
import { SpecVersionRepository } from "../../src/db/repositories/spec-versions.js";
import { StreamRepository } from "../../src/db/repositories/streams.js";
import { RunRepository } from "../../src/db/repositories/runs.js";

const spec = {
  seed: 1,
  currency: "INR",
  locale: "en-IN",
  channel: "upi",
  clock: { start: "2026-01-01", days: 7, then_stream_tps: 20 },
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

// Testcontainers MySQL + Redis — stream start/pause/resume/stop, PATCH
// target_tps, GET stream state. Run via `pnpm test:integration`.
describe("stream control contract", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let runId: string;
  let scenarioId: string;
  let versionId: string;

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
    const runs = new RunRepository(db);
    const scenario = await scenarios.create({ name: "Stream control test", currency: "INR" });
    const version = await versions.create({ scenario_id: scenario.id, spec, author_type: "user" });
    await scenarios.setCurrentVersion(scenario.id, version.id);
    scenarioId = scenario.id;
    versionId = version.id;

    const launchResponse = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenario.id}/runs`,
      payload: {},
    });
    runId = launchResponse.json().id as string;
    // The history phase's completion wiring lands with the worker process
    // bootstrap (a pre-existing gap this story doesn't own) — tests
    // simulate a finished history phase directly, the same way
    // test_ws_progress.ts simulates "running" directly.
    await runs.setStatus(runId, "completed");
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
  });

  it("rejects starting a stream for a run that hasn't completed its history phase", async () => {
    const otherRun = await new RunRepository(getDb()).create({
      scenario_id: scenarioId,
      spec_version_id: versionId,
      spec_snapshot: spec,
      seed: 1n,
      params: {},
      mode: "history_then_live",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${otherRun.id}/stream/start`,
      payload: {},
    });
    expect(response.statusCode).toBe(409);
  });

  it("rejects an inline sink with inline_sink_removed", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/stream/start`,
      payload: { sink: { type: "webhook", config: { url: "http://localhost:9/nowhere" } } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("inline_sink_removed");
  });

  it("starts a stream, falling back to spec.clock.then_stream_tps when target_tps is omitted", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/stream/start`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.state).toBe("streaming");
    expect(body.target_tps).toBe(spec.clock.then_stream_tps);
  });

  it("rejects a second start while already streaming", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/stream/start`,
      payload: {},
    });
    expect(response.statusCode).toBe(409);
  });

  it("pauses, then rejects a second pause", async () => {
    const pause = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/stream/pause`,
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().state).toBe("paused");

    const secondPause = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/stream/pause`,
    });
    expect(secondPause.statusCode).toBe(409);
  });

  it("resumes a paused stream", async () => {
    const resume = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/stream/resume`,
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().state).toBe("streaming");
  });

  it("adjusts target_tps live via PATCH", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/runs/${runId}/stream`,
      payload: { target_tps: 99 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().target_tps).toBe(99);
  });

  it("GET reflects current state", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream` });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("streaming");
    expect(response.json().target_tps).toBe(99);
  });

  it("stops the stream; PATCH afterward is rejected", async () => {
    const stop = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/stream/stop` });
    expect(stop.statusCode).toBe(200);
    expect(stop.json().state).toBe("stopped");

    const patchAfterStop = await app.inject({
      method: "PATCH",
      url: `/api/v1/runs/${runId}/stream`,
      payload: { target_tps: 10 },
    });
    expect(patchAfterStop.statusCode).toBe(409);
  });

  it("GET returns every StreamMetrics field, even before the worker has reported", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream` });
    const body = response.json();
    for (const field of [
      "achieved_tps",
      "target_tps",
      "aimd_rate",
      "sink_lag",
      "in_flight",
      "retry_queue",
      "backpressure",
      "delivered_total",
      "failed_total",
      "sim_time",
      "last_error",
    ]) {
      expect(body, field).toHaveProperty(field);
    }
    expect(body.backpressure).toBe(false);
    expect(body.last_error).toBeNull();
  });

  describe("after the destination's breaker trips", () => {
    it("reports the error state with last_error, and metrics the worker wrote", async () => {
      const streams = new StreamRepository(getDb());
      const stream = (await streams.getByRunId(runId))!;
      await streams.setMetrics(stream.id, {
        achieved_tps: 12,
        aimd_rate: 7,
        sink_lag: 340,
        in_flight: 8,
      });
      await streams.setLastError(stream.id, "More than half of the last 120 deliveries failed");
      await streams.setState(stream.id, "error");

      const body = (
        await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream` })
      ).json();
      expect(body.state).toBe("error");
      expect(body.last_error).toContain("More than half");
      expect(body).toMatchObject({ achieved_tps: 12, aimd_rate: 7, sink_lag: 340, in_flight: 8 });
    });

    it("refuses a start from error, accepts stop, then start gives a new session", async () => {
      const refused = await app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/stream/start`,
        payload: {},
      });
      expect(refused.statusCode).toBe(409);

      const stopped = await app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/stream/stop`,
      });
      expect(stopped.statusCode).toBe(200);
      expect(stopped.json().state).toBe("stopped");

      const sessionsBefore = (
        await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream/sessions` })
      ).json().sessions.length;
      const started = await app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/stream/start`,
        payload: {},
      });
      expect(started.statusCode).toBe(200);
      expect(started.json().state).toBe("streaming");
      const sessions = (
        await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream/sessions` })
      ).json().sessions;
      expect(sessions.length).toBe(sessionsBefore + 1);
    });
  });
});
