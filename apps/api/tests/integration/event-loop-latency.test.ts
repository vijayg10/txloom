import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues, getQueues } from "../../src/services/queues.js";
import { tinySpec } from "../support/tiny-spec.js";

const MAX_DELAY_MS = 100; // SC-014

// Constitution Principle V: generation never runs on the API event loop. Testcontainers MySQL +
// Redis. Run via `pnpm test:integration`.
describe("API event-loop latency at reference scale (SC-014)", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;

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
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
  });

  async function scenarioWith(spec: unknown, name: string): Promise<string> {
    const scenario = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name, currency: "INR" },
    });
    const id = scenario.json().id as string;
    const saved = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${id}/versions`,
      payload: { spec },
    });
    expect(saved.statusCode).toBe(201);
    return id;
  }

  /** Runs `operation` and returns the worst event-loop stall observed while it ran. */
  async function maxStallMs(operation: () => Promise<void>): Promise<number> {
    const histogram = monitorEventLoopDelay({ resolution: 5 });
    histogram.enable();
    await operation();
    // One more tick so a stall at the very end is still sampled.
    await new Promise((resolve) => setTimeout(resolve, 20));
    histogram.disable();
    return histogram.max / 1e6;
  }

  it("launch, pause/resume and stream start of a 200k-consumer spec never stall the loop", async () => {
    // Warm every lazy path (DB pool, validators, queues) so the measurement is steady-state.
    const warmId = await scenarioWith(tinySpec(), "warm-up");
    const warmRun = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${warmId}/runs`,
      payload: {},
    });
    await app.inject({ method: "POST", url: `/api/v1/runs/${warmRun.json().id}/pause` });
    await app.inject({ method: "POST", url: `/api/v1/runs/${warmRun.json().id}/resume` });

    const bigSpec = tinySpec({ consumers: 200_000, days: 90 });
    bigSpec.population.merchants.count = 5_000;
    const scenarioId = await scenarioWith(bigSpec, "reference-scale");

    let runId = "";
    const launchStall = await maxStallMs(async () => {
      const launch = await app.inject({
        method: "POST",
        url: `/api/v1/scenarios/${scenarioId}/runs`,
        payload: {},
      });
      expect(launch.statusCode).toBe(201);
      runId = launch.json().id;
    });

    const resumeStall = await maxStallMs(async () => {
      await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/pause` });
      const resume = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/resume` });
      expect(resume.statusCode).toBe(200);
    });

    await getQueues().generatePartition.obliterate({ force: true });
    await getDb()("run_partitions").where({ run_id: runId }).update({ state: "done" });
    await getDb()("runs").where({ id: runId }).update({ status: "completed" });
    const streamStall = await maxStallMs(async () => {
      const start = await app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/stream/start`,
        payload: { target_tps: 100 },
      });
      expect(start.statusCode).toBe(200);
    });

    expect(launchStall).toBeLessThan(MAX_DELAY_MS);
    expect(resumeStall).toBeLessThan(MAX_DELAY_MS);
    expect(streamStall).toBeLessThan(MAX_DELAY_MS);
  }, 180_000);

  // R19: exports are built by a worker job, never in the API process. A 2M-event export runs in a
  // separate process (the worker's job function), while the API keeps answering requests.
  it("keeps the loop responsive while a 2M-event export is built", async () => {
    const child = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../support/export-scale-child.ts",
    );
    const dataDir = await mkdtemp(path.join(tmpdir(), "txloom-export-scale-"));
    process.env.DATA_DIR = dataDir;
    // Routes read DATA_DIR when they are registered, so this needs its own app instance.
    const exportApp = await buildApp();
    try {
      const scenarioId = await scenarioWith(tinySpec(), "export-scale");
      const launch = await exportApp.inject({
        method: "POST",
        url: `/api/v1/scenarios/${scenarioId}/runs`,
        payload: {},
      });
      const runId = launch.json().id as string;
      await getQueues().generatePartition.obliterate({ force: true });

      await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", child, "seed", dataDir, runId, "2000000"],
        { env: process.env, maxBuffer: 1 << 24 },
      );

      const queued = await exportApp.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/exports`,
        payload: { format: "csv", source: { kind: "truth" } },
      });
      expect(queued.statusCode).toBe(202);
      const exportId = queued.json().export_id as string;

      const stall = await maxStallMs(async () => {
        const building = spawn(
          process.execPath,
          ["--import", "tsx", child, "build", dataDir, runId, exportId],
          { env: process.env, stdio: "ignore" },
        );
        const finished = new Promise<void>((resolve) => building.on("exit", () => resolve()));
        let done = false;
        void finished.then(() => (done = true));
        while (!done) {
          const status = await exportApp.inject({
            method: "GET",
            url: `/api/v1/runs/${runId}/exports/${exportId}`,
          });
          expect(status.statusCode).toBe(200);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      });

      const final = await exportApp.inject({
        method: "GET",
        url: `/api/v1/runs/${runId}/exports/${exportId}`,
      });
      expect(final.json().status).toBe("completed");
      expect(stall).toBeLessThan(MAX_DELAY_MS);
    } finally {
      await exportApp.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 600_000);
});
