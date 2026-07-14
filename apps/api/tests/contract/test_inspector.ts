import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { ScenarioRepository } from "../../src/db/repositories/scenarios.js";
import { SpecVersionRepository } from "../../src/db/repositories/spec-versions.js";
import { RunRepository } from "../../src/db/repositories/runs.js";
import { generateMerchantPool, generatePartition } from "@txloom/engine";
import { writeParquet, TRUTH_EVENT_SCHEMA, LABEL_RECORD_SCHEMA } from "@txloom/sinks";

const spec = {
  seed: 5,
  currency: "INR",
  locale: "en-IN",
  channel: "upi",
  clock: { start: "2026-01-01", days: 10 },
  population: {
    consumers: {
      count: 10,
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
      count: 3,
      categories: {
        grocery: {
          name: "grocery",
          weight: 1,
          amount_distribution: { kind: "lognormal", mean: 500, stddev: 100 },
        },
      },
    },
  },
  seasonality: [
    { event: "test-window", window: ["2026-01-03", "2026-01-04"], volume_multiplier: 2 },
  ],
  fraud: {
    target_rate: 0.05,
    typologies: [
      {
        type: "card_testing",
        share: 1,
        params: {
          burst_size_min: 3,
          burst_size_max: 5,
          burst_window_minutes: 5,
          amount_min: 1,
          amount_max: 20,
        },
      },
    ],
  },
  outcomes: { baseline_decline_rate: 0.02 },
  imperfections: { duplicate_delivery: { rate: 0.05, sinks: ["primary"] } },
  output: { sinks: [{ type: "file", name: "primary", format: "csv" }], labels: "separate_export" },
};

// Testcontainers MySQL — inspector aggregates + run compare, seeded with a
// real generated partition on disk (not a live worker). Run via `pnpm test:integration`.
describe("world inspector & run compare contract", () => {
  let mysql: StartedTestContainer;
  let app: FastifyInstance;
  let dataDir: string;
  let runIdA: string;
  let runIdB: string;

  async function seedRun(): Promise<string> {
    const db = getDb();
    const scenarios = new ScenarioRepository(db);
    const versions = new SpecVersionRepository(db);
    const runs = new RunRepository(db);
    const scenario = await scenarios.create({ name: "Inspector test", currency: "INR" });
    const version = await versions.create({ scenario_id: scenario.id, spec, author_type: "user" });
    const run = await runs.create({
      scenario_id: scenario.id,
      spec_version_id: version.id,
      spec_snapshot: spec,
      seed: BigInt(spec.seed),
      params: {},
      mode: "batch",
    });

    const merchants = generateMerchantPool(spec as never, BigInt(spec.seed));
    const { truthEvents, labelRecords } = generatePartition(
      spec as never,
      BigInt(spec.seed),
      0,
      1,
      merchants,
    );
    const runDir = path.join(dataDir, "runs", run.id);
    await writeParquet(
      path.join(runDir, "truth", "part-0.parquet"),
      TRUTH_EVENT_SCHEMA,
      truthEvents as unknown as Record<string, unknown>[],
    );
    await writeParquet(
      path.join(runDir, "labels", "part-0.parquet"),
      LABEL_RECORD_SCHEMA,
      labelRecords as unknown as Record<string, unknown>[],
    );
    return run.id;
  }

  beforeAll(async () => {
    mysql = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();
    process.env.DATABASE_URL = `mysql://root:test@${mysql.getHost()}:${mysql.getMappedPort(3306)}/txloom_test`;
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-inspector-"));
    process.env.DATA_DIR = dataDir;
    await getDb().migrate.latest();
    app = await buildApp();

    runIdA = await seedRun();
    runIdB = await seedRun();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closeDb();
    await mysql?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("GET /runs/:id/inspector/volume-over-time returns daily counts + seasonality", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${runIdA}/inspector/volume-over-time`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.points.length).toBeGreaterThan(0);
    expect(body.seasonality).toHaveLength(1);
  });

  it("GET /runs/:id/inspector/amount-distributions returns per-type buckets", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${runIdA}/inspector/amount-distributions`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().buckets.length).toBeGreaterThan(0);
  });

  it("GET /runs/:id/inspector/persona-heatmap returns a 7x24 grid", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${runIdA}/inspector/persona-heatmap`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().cells).toHaveLength(7 * 24);
  });

  it("GET /runs/:id/inspector/fraud-timeline returns fraud points", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${runIdA}/inspector/fraud-timeline`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().points.length).toBeGreaterThan(0);
  });

  it("GET /runs/:id/inspector/imperfection-audit returns corruption rows", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${runIdA}/inspector/imperfection-audit`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().rows.length).toBeGreaterThan(0);
  });

  it("GET /runs/compare?a&b returns both sides", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/runs/compare?a=${runIdA}&b=${runIdB}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.a.run.id).toBe(runIdA);
    expect(body.b.run.id).toBe(runIdB);
  });
});
