import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { ENGINE_VERSION } from "@txloom/engine";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues, getQueues } from "../../src/services/queues.js";
import { tinySpec } from "../support/tiny-spec.js";

// Testcontainers MySQL + Redis. Run via `pnpm test:integration`.
describe("POST /runs/:id/retry contract", () => {
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

    const scenario = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: "Retry test", currency: "INR" },
    });
    scenarioId = scenario.json().id;
    // Four consumers per partition gives a four-partition run.
    process.env.TXLOOM_PARTITION_CHUNK_SIZE = "1";
    await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/versions`,
      payload: { spec: tinySpec({ consumers: 4 }) },
    });
  }, 180_000);

  afterAll(async () => {
    delete process.env.TXLOOM_PARTITION_CHUNK_SIZE;
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
  });

  async function launchFailedRun(): Promise<string> {
    const launch = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload: {},
    });
    const runId = launch.json().id as string;
    const db = getDb();
    // Partitions 0 and 1 finished; 2 failed; 3 never ran. Drop the launch jobs so the test
    // observes only what retry enqueues.
    await db("run_partitions").where({ run_id: runId, partition_no: 0 }).update({ state: "done" });
    await db("run_partitions").where({ run_id: runId, partition_no: 1 }).update({ state: "done" });
    await db("run_partitions")
      .where({ run_id: runId, partition_no: 2 })
      .update({ state: "failed" });
    await db("runs").where({ id: runId }).update({ status: "failed", error: "boom" });
    await getQueues().generatePartition.obliterate({ force: true });
    return runId;
  }

  it.each(["running", "paused", "completed", "cancelled"])(
    "rejects a retry from %s with 409 invalid_state",
    async (status) => {
      const runId = await launchFailedRun();
      await getDb()("runs").where({ id: runId }).update({ status });
      const response = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/retry` });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("invalid_state");
    },
  );

  it("404s for an unknown run", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/runs/nope/retry" });
    expect(response.statusCode).toBe(404);
  });

  it("re-enqueues only the unfinished partitions with an -r<k> suffix and resumes the run", async () => {
    const runId = await launchFailedRun();
    const response = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/retry` });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("running");
    expect(response.json().retry_count).toBe(1);

    const queue = getQueues().generatePartition;
    expect(await queue.getJob(`${runId}-0-r1`)).toBeUndefined();
    expect(await queue.getJob(`${runId}-1-r1`)).toBeUndefined();
    expect(await queue.getJob(`${runId}-2-r1`)).toBeDefined();
    expect(await queue.getJob(`${runId}-3-r1`)).toBeDefined();

    const partitions = await getDb()("run_partitions")
      .where({ run_id: runId })
      .orderBy("partition_no");
    expect(partitions.map((p) => p.state)).toEqual(["done", "done", "pending", "pending"]);

    // A second failure and retry uses the next suffix.
    await getDb()("runs").where({ id: runId }).update({ status: "failed" });
    await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/retry` });
    expect(await queue.getJob(`${runId}-2-r2`)).toBeDefined();
  });

  it("refuses a run made by another engine version", async () => {
    const runId = await launchFailedRun();
    await getDb()("runs")
      .where({ id: runId })
      .update({ engine_version: ENGINE_VERSION - 1 });
    const response = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/retry` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("engine_version_mismatch");
  });
});
