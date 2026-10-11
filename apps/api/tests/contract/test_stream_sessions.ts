import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { generateMerchantPool, generatePartition } from "@txloom/engine";
import type { Sink } from "@txloom/sinks";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues, getQueues } from "../../src/services/queues.js";
import { StreamRepository } from "../../src/db/repositories/streams.js";
import { StreamSessionRepository } from "../../src/db/repositories/stream-sessions.js";
import {
  startStreamDriveWorker,
  type StreamDriveJobData,
} from "../../../worker/src/jobs/stream-drive.js";
import { tinySpec } from "../support/tiny-spec.js";

// Testcontainers MySQL + Redis, with the real stream-drive worker running in-process against a
// fake sink. Run via `pnpm test:integration`.
describe("stream sessions contract", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let worker: Worker<StreamDriveJobData>;
  let connectionId: string;
  const published = new Map<string, number>(); // sink name → count, keyed per run via sink label

  function fakeSink(label: string): Sink {
    return {
      type: "webhook",
      name: label,
      maxInFlight: 8,
      publish: async () => {
        published.set(label, (published.get(label) ?? 0) + 1);
        return { ok: true };
      },
      probe: async () => ({ ok: true, stage: "done", detail: "fake", latency_ms: 0 }),
      close: async () => {},
    };
  }

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
    process.env.DATA_DIR = "/tmp/txloom-stream-sessions-test";
    await getDb().migrate.latest();
    app = await buildApp();

    const streams = new StreamRepository(getDb());
    const sessions = new StreamSessionRepository(getDb());
    const spec = tinySpec();
    const history = generatePartition(
      spec as never,
      BigInt(spec.seed),
      0,
      1,
      generateMerchantPool(spec as never, BigInt(spec.seed)),
    );
    worker = startStreamDriveWorker({
      connection: getQueues().streamDrive.opts.connection!,
      // Each run's sessions publish to a sink labelled with the run, so concurrent streams
      // can be told apart.
      createSink: () => fakeSink(currentRun),
      loadCheckpoint: async () => history.worldCheckpoint,
      getStreamControl: async (streamId) => {
        const stream = await streams.getById(streamId);
        if (!stream) return { state: "stopped", targetTps: 0 };
        return {
          state: stream.state,
          targetTps: stream.target_tps,
          currentSessionId: stream.current_session_id,
        };
      },
      onMetrics: async (streamId, metrics) => streams.setMetrics(streamId, metrics),
      onSessionProgress: (sessionId, progress) => sessions.recordProgress(sessionId, progress),
      onSessionEnded: (sessionId, error) => sessions.end(sessionId, error),
      tickMs: 50,
    });

    const connection = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      payload: { type: "webhook", name: "sessions-hook", config: { url: "http://localhost:9/x" } },
    });
    connectionId = connection.json().id;
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
  });

  // The fake sink factory has no run context, so tests set which label to publish under.
  let currentRun = "";

  /** A completed run with one webhook destination, ready to stream. */
  async function completedRun(label: string): Promise<string> {
    const scenario = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: `Sessions ${label}`, currency: "INR" },
    });
    const scenarioId = scenario.json().id as string;
    const spec = tinySpec();
    spec.output.sinks.push({ type: "webhook", name: "live" } as never);
    await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/versions`,
      payload: { spec },
    });
    const launch = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload: { destinations: [{ sink: "live", connection_id: connectionId }] },
    });
    expect(launch.statusCode).toBe(201);
    const runId = launch.json().id as string;
    await getQueues().generatePartition.obliterate({ force: true });
    await getDb()("run_partitions").where({ run_id: runId }).update({ state: "done" });
    await getDb()("runs").where({ id: runId }).update({ status: "completed" });
    return runId;
  }

  async function start(runId: string, label: string) {
    currentRun = label;
    return app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/stream/start`,
      payload: { target_tps: 50 },
    });
  }

  const stop = (runId: string) =>
    app.inject({ method: "POST", url: `/api/v1/runs/${runId}/stream/stop` });

  async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("timed out waiting for condition");
  }

  it("start, stop, start gives session seq 2 with its own job, and events are published", async () => {
    const runId = await completedRun("restart");
    expect((await start(runId, "restart-1")).statusCode).toBe(200);
    await waitFor(() => (published.get("restart-1") ?? 0) > 0);
    expect((await stop(runId)).statusCode).toBe(200);

    await waitFor(
      async () =>
        (await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream/sessions` })).json()
          .sessions[0]?.ended_at,
    );
    expect((await start(runId, "restart-2")).statusCode).toBe(200);
    await waitFor(() => (published.get("restart-2") ?? 0) > 0);

    const sessions = (
      await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream/sessions` })
    ).json().sessions;
    expect(sessions.map((s: { seq: number }) => s.seq)).toEqual([1, 2]);
    expect(sessions[0].destinations_snapshot[0].connection_id).toBe(connectionId);
    expect(await getQueues().streamDrive.getJob(`stream-${runId}-1`)).toBeDefined();
    expect(await getQueues().streamDrive.getJob(`stream-${runId}-2`)).toBeDefined();
    await stop(runId);
  });

  it("start while paused returns 409 stream_paused with the remedy", async () => {
    const runId = await completedRun("paused");
    await start(runId, "paused-1");
    await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/stream/pause` });
    const response = await start(runId, "paused-2");
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("stream_paused");
    expect(response.json().error.message).toContain("Resume it, or stop it first");
    await stop(runId);
  });

  it("two runs stream concurrently and both publish within 30 s (SC-011)", async () => {
    const [a, b] = [await completedRun("a"), await completedRun("b")];
    const startedAt = Date.now();
    await Promise.all([start(a, "concurrent-a"), start(b, "concurrent-b")]);
    // Metrics carry the last published event, so each stream's own row proves it published.
    for (const runId of [a, b]) {
      await waitFor(async () => {
        const stream = (
          await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream` })
        ).json();
        return Boolean(stream.metrics?.ticker);
      });
    }
    expect(Date.now() - startedAt).toBeLessThan(30_000);
    await Promise.all([stop(a), stop(b)]);
  });

  it("returns 409 stream_limit when TXLOOM_MAX_STREAMS sessions are busy", async () => {
    const [a, b] = [await completedRun("lim-a"), await completedRun("lim-b")];
    await getDb()("stream_sessions").update({ ended_at: getDb().fn.now() });
    process.env.TXLOOM_MAX_STREAMS = "1";
    try {
      expect((await start(a, "limit-a")).statusCode).toBe(200);
      const response = await start(b, "limit-b");
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("stream_limit");
    } finally {
      delete process.env.TXLOOM_MAX_STREAMS;
      await stop(a);
    }
  });

  it("refuses a stream whose destination connection was deleted", async () => {
    const runId = await completedRun("deleted");
    const connection = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      payload: { type: "webhook", name: "doomed", config: { url: "http://localhost:9/y" } },
    });
    await getDb()("run_destinations").where({ run_id: runId }).update({ connection_id: null });
    const response = await start(runId, "deleted-1");
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("destination_connection_missing");
    expect(connection.statusCode).toBe(201);
  });
});
