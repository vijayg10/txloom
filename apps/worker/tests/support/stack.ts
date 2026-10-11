import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../api/src/app.js";
import { closeDb, getDb } from "../../../api/src/db/knex.js";
import { closeQueues, getQueues } from "../../../api/src/services/queues.js";

/** MySQL + Redis + the real API app, for worker tests that need runs to exist. */
export interface TestStack {
  app: FastifyInstance;
  dataDir: string;
  stop(): Promise<void>;
}

export async function startStack(): Promise<TestStack> {
  const [mysql, redis]: StartedTestContainer[] = await Promise.all([
    new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start(),
    new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
  ]);
  const dataDir = await mkdtemp(path.join(tmpdir(), "txloom-worker-"));
  process.env.DATABASE_URL = `mysql://root:test@${mysql.getHost()}:${mysql.getMappedPort(3306)}/txloom_test`;
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.DATA_DIR = dataDir;
  await getDb().migrate.latest();
  const app = await buildApp();

  return {
    app,
    dataDir,
    async stop() {
      await app.close();
      await closeQueues();
      await closeDb();
      await mysql.stop();
      await redis.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export function queueConnection() {
  return getQueues().generatePartition.opts.connection!;
}

/** Saves `spec` on a fresh scenario and launches it, returning the run ID. */
export async function launchSpec(
  app: FastifyInstance,
  spec: unknown,
  name: string,
): Promise<string> {
  const scenario = await app.inject({
    method: "POST",
    url: "/api/v1/scenarios",
    payload: { name, currency: "INR" },
  });
  const scenarioId = scenario.json().id as string;
  const saved = await app.inject({
    method: "POST",
    url: `/api/v1/scenarios/${scenarioId}/versions`,
    payload: { spec },
  });
  if (saved.statusCode !== 201) throw new Error(`save failed: ${saved.body}`);
  const launch = await app.inject({
    method: "POST",
    url: `/api/v1/scenarios/${scenarioId}/runs`,
    payload: {},
  });
  if (launch.statusCode !== 201) throw new Error(`launch failed: ${launch.body}`);
  return launch.json().id as string;
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}
