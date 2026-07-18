import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { readParquet } from "@txloom/sinks";
import { buildApp } from "../../../api/src/app.js";
import { closeDb, getDb } from "../../../api/src/db/knex.js";
import { closeQueues, getQueues } from "../../../api/src/services/queues.js";
import { ScenarioRepository } from "../../../api/src/db/repositories/scenarios.js";
import { SpecVersionRepository } from "../../../api/src/db/repositories/spec-versions.js";
import { startGeneratePartitionWorker } from "../../src/jobs/generate-partition.js";
import type { Worker } from "bullmq";

const spec = {
  seed: 42,
  currency: "INR",
  locale: "en-IN",
  channel: "upi",
  clock: { start: "2026-01-01", days: 5 },
  population: {
    consumers: {
      count: 60,
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
      count: 5,
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

// Testcontainers MySQL + Redis — pause mid-run, then resume, with a real
// BullMQ worker driving generate-partition (FR-018, SC-011: zero duplicated
// or missing truth events). Run via `pnpm test:integration`.
describe("pause/resume mid-run", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let dataDir: string;
  let worker: Worker;

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
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-pause-resume-"));
    process.env.DATA_DIR = dataDir;
    process.env.TXLOOM_MAX_WORKER_THREADS = "1";

    await getDb().migrate.latest();
    app = await buildApp();
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("resumes a paused run with every partition eventually done and zero duplicated truth events", async () => {
    const db = getDb();
    const scenarios = new ScenarioRepository(db);
    const versions = new SpecVersionRepository(db);
    const scenario = await scenarios.create({ name: "Pause/resume test", currency: "INR" });
    const version = await versions.create({ scenario_id: scenario.id, spec, author_type: "user" });
    await scenarios.setCurrentVersion(scenario.id, version.id);

    const launchResponse = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenario.id}/runs`,
      payload: {},
    });
    const runId = launchResponse.json().id as string;

    // Pause immediately, before any partition worker has a chance to run —
    // this removes still-pending jobs from the queue.
    const pauseResponse = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/pause` });
    expect(pauseResponse.statusCode).toBe(200);

    const resumeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/resume`,
    });
    expect(resumeResponse.statusCode).toBe(200);

    // Only start the worker now, after pause+resume — proves resume re-enqueues
    // the work rather than relying on jobs that survived the pause.
    const connection = getQueues().generatePartition.opts.connection!;
    const completions = new Set<number>();
    await new Promise<void>((resolve, reject) => {
      worker = startGeneratePartitionWorker({
        connection,
        onPartitionRunning: async () => {},
        onPartitionDone: async (data) => {
          completions.add(data.partitionNo);
          if (completions.size >= data.partitionCount) resolve();
        },
        onPartitionFailed: async (_data, error) => reject(error),
      });
    });

    const truthDir = path.join(dataDir, "runs", runId, "truth");
    // The same directory also holds each partition's part-N.stats.json
    // (partition-worker.ts writes both in one pass) — only the .parquet
    // files are truth-event data.
    const files = (await readdir(truthDir)).filter((f) => f.endsWith(".parquet"));
    expect(files.length).toBeGreaterThan(0);

    const eventIds: string[] = [];
    for (const file of files) {
      for await (const row of readParquet(path.join(truthDir, file))) {
        eventIds.push(row.event_id as string);
      }
    }
    expect(eventIds.length).toBeGreaterThan(0);
    expect(new Set(eventIds).size).toBe(eventIds.length);
  }, 60_000);
});
