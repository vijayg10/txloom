import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Worker } from "bullmq";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { ENGINE_VERSION } from "@txloom/engine";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues, getQueues } from "../../src/services/queues.js";
import { tinySpec } from "../support/tiny-spec.js";
import {
  startExportBuildWorker,
  type ExportBuildJobData,
} from "../../../worker/src/jobs/export-build.js";

// `retry_run` and the export tools need a database and a queue, unlike the DB-free tools in
// test_mcp_parity.ts.
// Run via `pnpm test:integration`.
describe("MCP tools that need a database ↔ REST", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let client: Client;
  let scenarioId: string;
  let dataDir: string;
  let exportWorker: Worker<ExportBuildJobData>;

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
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-mcp-parity-"));
    process.env.DATA_DIR = dataDir;
    await getDb().migrate.latest();
    app = await buildApp();
    exportWorker = startExportBuildWorker({ connection: getQueues().exportBuild.opts.connection! });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address !== "object" || address === null) throw new Error("no server address");
    client = new Client({ name: "retry-parity", version: "0.0.1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)),
    );

    const scenario = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: "Retry parity", currency: "INR" },
    });
    scenarioId = scenario.json().id;
    await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/versions`,
      payload: { spec: tinySpec() },
    });
  }, 180_000);

  afterAll(async () => {
    await exportWorker?.close();
    await client?.close();
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  async function failedRun(patch: Record<string, unknown> = {}): Promise<string> {
    const launch = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload: {},
    });
    const runId = launch.json().id as string;
    await getQueues().generatePartition.obliterate({ force: true });
    await getDb()("run_partitions").where({ run_id: runId }).update({ state: "failed" });
    await getDb()("runs")
      .where({ id: runId })
      .update({ status: "failed", ...patch });
    return runId;
  }

  async function viaMcp(runId: string) {
    const result = await client.callTool({ name: "retry_run", arguments: { run_id: runId } });
    return JSON.parse((result.content as { text: string }[])[0]!.text);
  }

  it("returns the same 409 invalid_state body for a run that is not failed", async () => {
    const runId = await failedRun({ status: "completed" });
    const rest = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/retry` });
    expect(rest.statusCode).toBe(409);
    expect(await viaMcp(runId)).toEqual(rest.json());
  });

  it("returns the same 409 engine_version_mismatch body", async () => {
    const runId = await failedRun({ engine_version: ENGINE_VERSION - 1 });
    const rest = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/retry` });
    expect(rest.statusCode).toBe(409);
    const body = await viaMcp(runId);
    expect(body).toEqual(rest.json());
    expect(body.error.code).toBe("engine_version_mismatch");
  });

  it("retries a failed run exactly as the REST endpoint does", async () => {
    const viaTool = await failedRun();
    const viaRest = await failedRun();
    const toolBody = await viaMcp(viaTool);
    const restBody = (
      await app.inject({ method: "POST", url: `/api/v1/runs/${viaRest}/retry` })
    ).json();
    expect(toolBody.status).toBe("running");
    expect(toolBody.retry_count).toBe(restBody.retry_count);
    expect(Object.keys(toolBody).sort()).toEqual(Object.keys(restBody).sort());
  });

  describe("create_export / get_export ↔ /runs/:id/exports", () => {
    async function callTool(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    }

    it("create_export queues like POST, and get_export polls to the same completed manifest", async () => {
      const launch = await app.inject({
        method: "POST",
        url: `/api/v1/scenarios/${scenarioId}/runs`,
        payload: {},
      });
      const runId = launch.json().id as string;
      await getQueues().generatePartition.obliterate({ force: true });
      const request = { format: "json", source: { kind: "truth" } };

      const rest = await app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/exports`,
        payload: request,
      });
      expect(rest.statusCode).toBe(202);
      expect(rest.json().status).toBe("queued");

      const viaTool = await callTool("create_export", { run_id: runId, ...request });
      expect(viaTool.status).toBe("queued");
      expect(Object.keys(viaTool).sort()).toEqual(Object.keys(rest.json()).sort());

      let manifest = viaTool;
      for (let i = 0; i < 100 && manifest.status !== "completed"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        manifest = await callTool("get_export", { run_id: runId, export_id: viaTool.export_id });
      }
      expect(manifest.status).toBe("completed");
      const viaRest = await app.inject({
        method: "GET",
        url: `/api/v1/runs/${runId}/exports/${viaTool.export_id}`,
      });
      expect(manifest).toEqual(viaRest.json());
    });
  });
  describe("connections and destinations ↔ REST", () => {
    async function callTool(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    }

    it("list_connections equals GET /connections", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/connections",
        payload: {
          type: "webhook",
          name: "parity-hook",
          config: { url: "https://hooks.example.com/p" },
        },
      });
      expect(created.statusCode).toBe(201);
      const rest = await app.inject({ method: "GET", url: "/api/v1/connections" });
      expect(await callTool("list_connections", {})).toEqual(rest.json());
    });

    it("launch_run with destinations is equivalent to the REST call", async () => {
      const webhook = await app.inject({
        method: "POST",
        url: "/api/v1/connections",
        payload: {
          type: "webhook",
          name: "parity-launch",
          config: { url: "https://hooks.example.com/l" },
        },
      });
      const connectionId = webhook.json().id as string;
      const scenario = await app.inject({
        method: "POST",
        url: "/api/v1/scenarios",
        payload: { name: "Destinations parity", currency: "INR" },
      });
      const destScenarioId = scenario.json().id as string;
      const spec = tinySpec();
      spec.output.sinks.push({ type: "webhook", name: "live" } as never);
      await app.inject({
        method: "POST",
        url: `/api/v1/scenarios/${destScenarioId}/versions`,
        payload: { spec },
      });
      const destinations = [{ sink: "live", connection_id: connectionId }];

      const rest = await app.inject({
        method: "POST",
        url: `/api/v1/scenarios/${destScenarioId}/runs`,
        payload: { destinations },
      });
      expect(rest.statusCode).toBe(201);
      const viaTool = await callTool("launch_run", { scenario_id: destScenarioId, destinations });
      expect(Object.keys(viaTool).sort()).toEqual(Object.keys(rest.json()).sort());
      const rows = await getDb()("run_destinations").where({ run_id: viaTool.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ sink_name: "live", connection_id: connectionId });

      // The same validation errors come back through the tool.
      const missing = await callTool("launch_run", { scenario_id: destScenarioId });
      expect(missing.error.code).toBe("sink_without_destination");
    });

    it("start_stream rejects a sink input", async () => {
      const body = await callTool("start_stream", {
        run_id: "00000000-0000-0000-0000-000000000000",
        sink: { type: "kafka", brokers: ["localhost:9092"], topic: "x" },
      });
      expect(body.error.code).toBe("inline_sink_removed");
    });
  });
});
