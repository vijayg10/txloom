import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import type { FastifyInstance } from "fastify";

// Testcontainers MySQL — scenario/spec-version CRUD against a real DB.
// Run via `pnpm test:integration` (requires a local Docker daemon).
describe("scenarios & spec-versions contract", () => {
  let container: StartedTestContainer;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();

    process.env.DATABASE_URL = `mysql://root:test@${container.getHost()}:${container.getMappedPort(3306)}/txloom_test`;
    await getDb().migrate.latest();
    app = await buildApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await closeDb();
    await container?.stop();
  });

  it("POST /scenarios creates a blank scenario", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: "Test scenario", currency: "INR" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe("Test scenario");
  });

  it("GET /scenarios lists created scenarios", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/scenarios" });
    expect(response.statusCode).toBe(200);
    expect(response.json().scenarios.length).toBeGreaterThan(0);
  });

  it("GET /scenarios/:id returns 404 for an unknown id", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/scenarios/nonexistent" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });

  it("POST /scenarios/:id/versions saves a version and rejects an invalid spec", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: "Versioned", currency: "INR" },
    });
    const scenarioId = create.json().id;

    const invalidResponse = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/versions`,
      payload: { spec: { seed: 1 } },
    });
    expect(invalidResponse.statusCode).toBe(422);
    expect(invalidResponse.json().error.details.violations.length).toBeGreaterThan(0);
  });
});
