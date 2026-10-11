import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Worker } from "bullmq";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues, getQueues } from "../../src/services/queues.js";
import { tinySpec } from "../support/tiny-spec.js";
import {
  startConnectionTestWorker,
  type ConnectionTestJobData,
} from "../../../worker/src/jobs/connection-test.js";

const KAFKA_PASSWORD = "kafka-pa55-NEVER-LOG-ME";
const KAFKA_USER = "svc-NEVER-LOG-ME";
const WEBHOOK_HEADER = "Bearer webhook-NEVER-LOG-ME";
const SECRET_NEEDLES = [KAFKA_PASSWORD, KAFKA_USER, WEBHOOK_HEADER, "webhook-NEVER-LOG-ME"];

// FR-009: secrets are write-only. Capture the API's logger output and the worker's stdout while
// creating, testing, launching and streaming against connections with secrets, and assert none
// of them ever appear in a log line, an error message or a response body.
// Testcontainers MySQL + Redis. Run via `pnpm test:integration`.
describe("secret redaction", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let worker: Worker<ConnectionTestJobData>;
  let dataDir: string;
  let hookServer: http.Server;
  let hookUrl: string;
  const logged: string[] = [];
  const responses: string[] = [];

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
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-redaction-"));
    process.env.DATA_DIR = dataDir;

    // The worker's stdout: everything it prints through console, plus raw stdout/stderr writes.
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      logged.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      logged.push(String(chunk));
      return true;
    });

    await getDb().migrate.latest();
    const fastifyLog = new Writable({
      write(chunk, _encoding, callback) {
        logged.push(chunk.toString());
        callback();
      },
    });
    app = await buildApp({ logger: { level: "trace", stream: fastifyLog } });
    worker = startConnectionTestWorker({ connection: getQueues().connectionTest.opts.connection! });

    hookServer = http.createServer((_request, response) => {
      response.writeHead(200).end("{}");
    });
    await new Promise<void>((resolve) => hookServer.listen(0, "127.0.0.1", resolve));
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await worker?.close();
    await new Promise<void>((resolve) => hookServer?.close(() => resolve()));
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  async function call(method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
    const response = await app.inject({
      method,
      url,
      ...(payload !== undefined ? { payload } : {}),
    });
    responses.push(response.body);
    return response;
  }

  it("never writes a connection secret to a log line, error message or response", async () => {
    const kafka = await call("POST", "/api/v1/connections", {
      type: "kafka",
      name: "redact-kafka",
      config: {
        bootstrap_servers: ["127.0.0.1:1"],
        security_protocol: "SASL_PLAINTEXT",
        sasl_mechanism: "SCRAM-SHA-512",
        default_topic: "events",
      },
      secrets: { username: KAFKA_USER, password: KAFKA_PASSWORD },
    });
    expect(kafka.statusCode).toBe(201);
    const kafkaId = kafka.json().id as string;

    const webhook = await call("POST", "/api/v1/connections", {
      type: "webhook",
      name: "redact-hook",
      config: { url: hookUrl, timeout_ms: 2000, max_attempts: 1 },
      secrets: { headers: { authorization: WEBHOOK_HEADER } },
    });
    expect(webhook.statusCode).toBe(201);
    const webhookId = webhook.json().id as string;

    // Test both: the webhook succeeds; the kafka probe fails against a closed port (or outlives
    // the API's wait and returns 503), which is where an error message could leak credentials.
    const hookTest = await call("POST", `/api/v1/connections/${webhookId}/test`);
    expect(hookTest.statusCode).toBe(200);
    const kafkaTest = await call("POST", `/api/v1/connections/${kafkaId}/test`);
    expect([200, 503]).toContain(kafkaTest.statusCode);
    if (kafkaTest.statusCode === 200) expect(kafkaTest.json().ok).toBe(false);
    await call("POST", "/api/v1/connections/test", {
      type: "kafka",
      name: "redact-draft",
      config: {
        bootstrap_servers: ["127.0.0.1:1"],
        security_protocol: "SASL_PLAINTEXT",
        sasl_mechanism: "PLAIN",
        default_topic: "events",
      },
      secrets: { username: KAFKA_USER, password: KAFKA_PASSWORD },
    });
    await call("PATCH", `/api/v1/connections/${kafkaId}`, { name: "redact-kafka-renamed" });
    await call("GET", `/api/v1/connections/${kafkaId}`);
    await call("GET", "/api/v1/connections");

    // Launch a run with destinations on both, then start its stream.
    const scenario = await call("POST", "/api/v1/scenarios", {
      name: "Redaction",
      currency: "INR",
    });
    const scenarioId = scenario.json().id as string;
    const spec = tinySpec();
    spec.output.sinks.push({ type: "kafka", name: "events" } as never);
    spec.output.sinks.push({ type: "webhook", name: "live" } as never);
    await call("POST", `/api/v1/scenarios/${scenarioId}/versions`, { spec });
    const launch = await call("POST", `/api/v1/scenarios/${scenarioId}/runs`, {
      destinations: [
        { sink: "events", connection_id: kafkaId },
        { sink: "live", connection_id: webhookId },
      ],
    });
    expect(launch.statusCode).toBe(201);
    const runId = launch.json().id as string;
    await getQueues().generatePartition.obliterate({ force: true });
    await getDb()("run_partitions").where({ run_id: runId }).update({ state: "done" });
    await getDb()("runs").where({ id: runId }).update({ status: "completed" });
    const start = await call("POST", `/api/v1/runs/${runId}/stream/start`, { target_tps: 10 });
    expect([200, 201, 202]).toContain(start.statusCode);
    await call("GET", `/api/v1/runs/${runId}/stream`);
    await call("GET", `/api/v1/runs/${runId}`);
    await call("GET", `/api/v1/scenarios/${scenarioId}/launch-defaults`);

    const everything = [...logged, ...responses].join("\n");
    expect(logged.length).toBeGreaterThan(0); // the capture is actually wired up
    for (const needle of SECRET_NEEDLES) {
      expect(everything).not.toContain(needle);
    }
  }, 120_000);
});
