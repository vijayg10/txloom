import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { ScenarioRepository } from "../../src/db/repositories/scenarios.js";
import { SpecVersionRepository } from "../../src/db/repositories/spec-versions.js";
import { RunRepository, RunPartitionRepository } from "../../src/db/repositories/runs.js";

const spec = {
  seed: 1,
  currency: "INR",
  locale: "en-IN",
  channel: "upi",
  clock: { start: "2026-01-01", days: 1 },
  population: {
    consumers: {
      count: 1,
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
            daily_transaction_count_mean: 1,
            daily_transaction_count_stddev: 0.5,
            weekend_multiplier: 1,
          },
        },
      ],
    },
    merchants: {
      count: 1,
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

// Testcontainers MySQL — WS runs/:id/progress message shapes. Run via
// `pnpm test:integration`.
describe("WS runs/:id/progress channel contract", () => {
  let mysql: StartedTestContainer;
  let app: FastifyInstance;
  let runId: string;

  beforeAll(async () => {
    mysql = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();
    process.env.DATABASE_URL = `mysql://root:test@${mysql.getHost()}:${mysql.getMappedPort(3306)}/txloom_test`;
    await getDb().migrate.latest();
    app = await buildApp();

    const db = getDb();
    const scenarios = new ScenarioRepository(db);
    const versions = new SpecVersionRepository(db);
    const runs = new RunRepository(db);
    const runPartitions = new RunPartitionRepository(db);

    const scenario = await scenarios.create({ name: "WS test", currency: "INR" });
    const version = await versions.create({ scenario_id: scenario.id, spec, author_type: "user" });
    const run = await runs.create({
      scenario_id: scenario.id,
      spec_version_id: version.id,
      spec_snapshot: spec,
      seed: 1n,
      params: {},
      mode: "batch",
    });
    await runPartitions.createPending(run.id, 1);
    await runPartitions.checkpoint(run.id, 0, {}, 42);
    await runs.setStatus(run.id, "running");
    runId = run.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closeDb();
    await mysql?.stop();
  });

  it("streams a status transition and a per-partition tick matching the documented shape", async () => {
    const ws = await app.injectWS("/api/v1/ws");
    const messages: unknown[] = [];
    const done = new Promise<void>((resolve) => {
      ws.on("message", (raw: Buffer) => {
        messages.push(JSON.parse(raw.toString()));
        if (messages.length >= 2) resolve();
      });
    });

    ws.send(JSON.stringify({ subscribe: `runs/${runId}/progress` }));
    await done;
    ws.terminate();

    const statusMessage = messages.find((m) => (m as { status?: string }).status) as
      { status: string } | undefined;
    expect(statusMessage?.status).toBe("running");

    const tick = messages.find(
      (m) => (m as { partition_no?: number }).partition_no !== undefined,
    ) as
      | {
          partition_no: number;
          state: string;
          events_generated: number;
          throughput: number;
          eta: number | null;
        }
      | undefined;
    expect(tick).toBeDefined();
    expect(tick!.partition_no).toBe(0);
    expect(tick!.events_generated).toBe(42);
    expect(typeof tick!.throughput).toBe("number");
  }, 15_000);
});
