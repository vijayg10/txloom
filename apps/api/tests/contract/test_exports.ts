import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { RunRepository } from "../../src/db/repositories/runs.js";
import { ScenarioRepository } from "../../src/db/repositories/scenarios.js";
import { SpecVersionRepository } from "../../src/db/repositories/spec-versions.js";

// Testcontainers MySQL — export creation, the include_labels warning gate
// (FR-022), and download 404 handling. Run via `pnpm test:integration`.
describe("truth/exports contract", () => {
  let mysql: StartedTestContainer;
  let app: FastifyInstance;
  let dataDir: string;
  let runId: string;

  beforeAll(async () => {
    mysql = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();

    process.env.DATABASE_URL = `mysql://root:test@${mysql.getHost()}:${mysql.getMappedPort(3306)}/txloom_test`;
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-exports-"));
    process.env.DATA_DIR = dataDir;

    const db = getDb();
    await db.migrate.latest();
    app = await buildApp();

    const scenarios = new ScenarioRepository(db);
    const versions = new SpecVersionRepository(db);
    const runs = new RunRepository(db);
    const scenario = await scenarios.create({ name: "Export test", currency: "INR" });
    const version = await versions.create({
      scenario_id: scenario.id,
      spec: { seed: 1 },
      author_type: "user",
    });
    const run = await runs.create({
      scenario_id: scenario.id,
      spec_version_id: version.id,
      spec_snapshot: { seed: 1 },
      seed: 1n,
      params: {},
      mode: "batch",
    });
    runId = run.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closeDb();
    await mysql?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("POST /runs/:id/exports with include_labels:true and no acknowledged_warning returns 422 (FR-022)", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/exports`,
      payload: { format: "csv", include_labels: true },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("label_warning_required");
  });

  it("POST /runs/:id/exports with include_labels:true and acknowledged_warning:true succeeds", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/exports`,
      payload: { format: "csv", include_labels: true, acknowledged_warning: true },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().answer_key_file_name).toBeNull();
  });

  it("POST /runs/:id/exports without labels produces a distinct answer-key file (FR-021)", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/exports`,
      payload: { format: "csv" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.answer_key_file_name).toBe("labels.csv");
    expect(body.file_name).not.toBe(body.answer_key_file_name);
  });

  it("GET /runs/:id/exports/:exportId/download 404s for an unknown export", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${runId}/exports/nonexistent/download`,
    });
    expect(response.statusCode).toBe(404);
  });
});
