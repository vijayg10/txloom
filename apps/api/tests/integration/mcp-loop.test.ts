import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";

function toolJson<T>(result: { content: unknown }): T {
  return JSON.parse((result.content as { text: string }[])[0]!.text) as T;
}

const spec = {
  seed: 99,
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

// Testcontainers MySQL + Redis — the full agent loop: schema → validate →
// create → save version → launch run → get status → get report → export,
// entirely through the MCP client (FR-008/012, US2 Independent Test).
describe("full MCP loop", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let client: Client;

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
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address !== "object" || address === null) throw new Error("no server address");
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
    );
    client = new Client({ name: "loop-test-client", version: "0.0.1" });
    await client.connect(transport);
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    await app?.close();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
  });

  it("authors, saves, runs, and exports a scenario end to end via MCP tools", async () => {
    const schemaResult = await client.callTool({ name: "get_spec_schema", arguments: {} });
    expect(toolJson<{ title: string }>(schemaResult).title).toBe("SimulationSpec");

    const validateResult = await client.callTool({ name: "validate_spec", arguments: { spec } });
    expect(toolJson<{ valid: boolean }>(validateResult).valid).toBe(true);

    const createResult = await client.callTool({
      name: "create_scenario",
      arguments: { name: "MCP loop test", currency: "INR" },
    });
    const scenario = toolJson<{ id: string }>(createResult);
    expect(scenario.id).toBeTruthy();

    const saveResult = await client.callTool({
      name: "save_spec_version",
      arguments: { scenario_id: scenario.id, spec },
    });
    expect(toolJson<{ version_no: number }>(saveResult).version_no).toBe(1);

    const launchResult = await client.callTool({
      name: "launch_run",
      arguments: { scenario_id: scenario.id },
    });
    const run = toolJson<{ id: string; status: string }>(launchResult);
    expect(run.status).toBe("running");

    const statusResult = await client.callTool({
      name: "get_run_status",
      arguments: { run_id: run.id },
    });
    expect(toolJson<{ id: string }>(statusResult).id).toBe(run.id);

    const exportResult = await client.callTool({
      name: "create_export",
      arguments: { run_id: run.id, format: "csv" },
    });
    const exportManifest = toolJson<{ export_id: string; answer_key_file_name: string | null }>(
      exportResult,
    );
    expect(exportManifest.answer_key_file_name).toBe("labels.csv");

    const getExportResult = await client.callTool({
      name: "get_export",
      arguments: { run_id: run.id, export_id: exportManifest.export_id },
    });
    expect(toolJson<{ export_id: string }>(getExportResult).export_id).toBe(
      exportManifest.export_id,
    );
  }, 60_000);
});
