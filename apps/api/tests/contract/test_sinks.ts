import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";

// Testcontainers MySQL — sink-connection CRUD + test-connection action
// (FR-036 §6). Run via `pnpm test:integration`.
describe("sinks contract", () => {
  let mysql: StartedTestContainer;
  let app: FastifyInstance;
  let dataDir: string;

  beforeAll(async () => {
    mysql = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();
    process.env.DATABASE_URL = `mysql://root:test@${mysql.getHost()}:${mysql.getMappedPort(3306)}/txloom_test`;
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-sinks-"));
    process.env.DATA_DIR = dataDir;
    await getDb().migrate.latest();
    app = await buildApp();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeDb();
    await mysql?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("creates a sink connection and never echoes credentials back", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sinks",
      payload: {
        type: "kafka",
        name: "primary-kafka",
        config: { brokers: ["localhost:9092"], topic: "txloom" },
        credentials: { username: "u", password: "p" },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.has_credentials).toBe(true);
    expect(body).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("credentials_enc");
  });

  it("lists sinks", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/sinks" });
    expect(response.statusCode).toBe(200);
    expect(response.json().sinks.length).toBeGreaterThan(0);
  });

  it("updates a sink's config without disturbing its name", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sinks",
      payload: { type: "file", name: "local-files", config: { format: "csv" } },
    });
    const id = create.json().id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/sinks/${id}`,
      payload: { config: { format: "parquet" } },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().config).toEqual({ format: "parquet" });
    expect(patch.json().name).toBe("local-files");
  });

  it("POST /sinks/:id/test on a file sink succeeds with no remote connection", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sinks",
      payload: { type: "file", name: "test-target", config: {} },
    });
    const id = create.json().id;

    const testResponse = await app.inject({ method: "POST", url: `/api/v1/sinks/${id}/test` });
    expect(testResponse.statusCode).toBe(200);
    expect(testResponse.json().ok).toBe(true);

    const getResponse = await app.inject({ method: "GET", url: `/api/v1/sinks/${id}` });
    // mysql2 may surface a TINYINT(1) boolean column as 0/1 rather than
    // true/false depending on driver config — assert on truthiness instead
    // of the exact JS representation.
    expect(Boolean(getResponse.json().last_test_ok)).toBe(true);
  });

  it("deletes a sink", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sinks",
      payload: { type: "file", name: "to-delete", config: {} },
    });
    const id = create.json().id;

    const del = await app.inject({ method: "DELETE", url: `/api/v1/sinks/${id}` });
    expect(del.statusCode).toBe(204);

    const getResponse = await app.inject({ method: "GET", url: `/api/v1/sinks/${id}` });
    expect(getResponse.statusCode).toBe(404);
  });
});
