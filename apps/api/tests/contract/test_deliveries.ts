import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues, getQueues } from "../../src/services/queues.js";
import { RunDeliveryRepository } from "../../src/db/repositories/run-deliveries.js";
import { createGeneratePartitionCallbacks } from "../../../worker/src/handlers.js";
import { tinySpec } from "../support/tiny-spec.js";

// Testcontainers MySQL + Redis. The history replay lifecycle (FR-021): rows created when
// generation finishes, retry from the cursor, skip, and the live phase waiting on both.
// Run via `pnpm test:integration`.
describe("run deliveries contract", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let dataDir: string;
  let connectionId: string;

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
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-deliveries-"));
    process.env.DATA_DIR = dataDir;
    await getDb().migrate.latest();
    app = await buildApp();

    const connection = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      payload: { type: "webhook", name: "hook", config: { url: "http://localhost:9/x" } },
    });
    connectionId = connection.json().id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  /** Launches a run with `replay_history`, with `sinkNames` bound, and finishes generation the
   * way the worker does (through `maybeCompleteRun`). */
  async function replayRun(sinkNames: string[], replay = true): Promise<string> {
    const scenario = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: `Deliveries ${Math.random()}`, currency: "INR" },
    });
    const scenarioId = scenario.json().id as string;
    const spec = tinySpec();
    for (const name of sinkNames) spec.output.sinks.push({ type: "webhook", name } as never);
    await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/versions`,
      payload: { spec },
    });
    const launch = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload: {
        mode: "history_then_live",
        replay_history: replay,
        destinations: sinkNames.map((sink) => ({ sink, connection_id: connectionId })),
      },
    });
    expect(launch.statusCode).toBe(201);
    const runId = launch.json().id as string;
    await getQueues().generatePartition.obliterate({ force: true });
    await getDb()("run_partitions").where({ run_id: runId }).update({ state: "done" });
    await createGeneratePartitionCallbacks({
      db: getDb(),
      queues: getQueues(),
      dataDir,
    }).maybeCompleteRun(runId);
    return runId;
  }

  const deliveries = () => new RunDeliveryRepository(getDb());

  it("a webhook connection created with only a URL is stored with its schema defaults", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/connections/${connectionId}`,
    });
    expect(response.json().config).toMatchObject({ timeout_ms: 5000, max_attempts: 5 });
  });

  it("replay_history:true creates one run_deliveries row per bound sink and queues its job", async () => {
    const runId = await replayRun(["live-a", "live-b"]);
    const rows = await deliveries().listByRun(runId);
    expect(rows.map((r) => r.sink_name).sort()).toEqual(["live-a", "live-b"]);
    expect(rows.every((r) => r.state === "pending")).toBe(true);
    expect(rows[0]!.destination_snapshot).toMatchObject({ connection_name: "hook" });

    const queued = await getQueues().deliver.getJobs(["waiting", "delayed", "active"]);
    const forRun = queued.filter((job) => job.data.runId === runId);
    expect(forRun.map((job) => job.data.sinkName).sort()).toEqual(["live-a", "live-b"]);

    const run = (await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` })).json();
    expect(run.deliveries.map((d: { sink: string }) => d.sink).sort()).toEqual([
      "live-a",
      "live-b",
    ]);
  });

  it("creates no deliveries when replay_history is off", async () => {
    const runId = await replayRun(["live-a"], false);
    expect(await deliveries().listByRun(runId)).toEqual([]);
  });

  it("retry continues from the cursor, and only a failed delivery can be retried", async () => {
    const runId = await replayRun(["live-a"]);
    const repo = deliveries();
    const notFailed = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/deliveries/live-a/retry`,
    });
    expect(notFailed.statusCode).toBe(409);
    expect(notFailed.json().error.code).toBe("invalid_state");

    await repo.markRunning(runId, "live-a", 100);
    await repo.recordProgress(runId, "live-a", {
      cursor: { file_index: 0, row: 40 },
      published: 38,
      failed: 2,
    });
    await repo.finish(runId, "live-a", { state: "failed", error: "breaker" });

    const retried = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/deliveries/live-a/retry`,
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      sink: "live-a",
      state: "running",
      published: 38,
      failed: 2,
      cursor: { file_index: 0, row: 40 },
    });
    const jobs = (await getQueues().deliver.getJobs(["waiting", "delayed", "active"])).filter(
      (job) => job.data.runId === runId,
    );
    expect(jobs.length).toBeGreaterThanOrEqual(2); // the original and the retry
  });

  it("skip moves a failed delivery to skipped", async () => {
    const runId = await replayRun(["live-a"]);
    const repo = deliveries();
    await repo.markRunning(runId, "live-a", 10);
    await repo.finish(runId, "live-a", { state: "failed", error: "down" });
    const skipped = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/deliveries/live-a/skip`,
    });
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json().state).toBe("skipped");
    const unknown = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/deliveries/nope/skip`,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("stream/start returns 409 replay_pending while a delivery is pending, running or failed", async () => {
    const runId = await replayRun(["live-a"]);
    const repo = deliveries();
    const start = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/stream/start`,
        payload: { target_tps: 20 },
      });

    for (const prepare of [
      async () => {}, // pending
      () => repo.markRunning(runId, "live-a", 10),
      () => repo.finish(runId, "live-a", { state: "failed", error: "down" }),
    ]) {
      await prepare();
      const response = await start();
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("replay_pending");
    }

    await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/deliveries/live-a/skip` });
    // Skipping the last blocking replay of a history_then_live run starts the live stream by
    // itself, so a manual start now finds it already running, and is no longer blocked by replay.
    const afterSkip = await start();
    expect(afterSkip.json().error?.code).not.toBe("replay_pending");
    const stream = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream` });
    expect(stream.json().state).toBe("streaming");
  });
});
