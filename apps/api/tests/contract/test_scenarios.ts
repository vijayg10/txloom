import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import type { FastifyInstance } from "fastify";
import { ScenarioRepository } from "../../src/db/repositories/scenarios.js";
import { SpecVersionRepository } from "../../src/db/repositories/spec-versions.js";

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

  describe("stored specs that no longer validate (400 spec_invalid)", () => {
    // Specs validated when they were saved can go stale as invariants change, so they are
    // inserted straight into the database, bypassing the save-time check.
    async function scenarioWithInvalidVersion() {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/scenarios",
        payload: { name: `Stale ${Date.now()}`, currency: "INR" },
      });
      const scenarioId = create.json().id as string;
      const version = await new SpecVersionRepository(getDb()).create({
        scenario_id: scenarioId,
        spec: { seed: 1 },
        author_type: "user",
      });
      return { scenarioId, versionId: version.id };
    }

    function expectLocatedViolations(response: { statusCode: number; json(): unknown }) {
      expect(response.statusCode).toBe(400);
      const { error } = response.json() as {
        error: { code: string; details: { violations: { path: string }[] } };
      };
      expect(error.code).toBe("spec_invalid");
      expect(error.details.violations.length).toBeGreaterThan(0);
      for (const violation of error.details.violations) {
        expect(violation.path.startsWith("/")).toBe(true);
      }
    }

    it("rolling back to an invalid version is rejected", async () => {
      const { scenarioId, versionId } = await scenarioWithInvalidVersion();
      expectLocatedViolations(
        await app.inject({
          method: "POST",
          url: `/api/v1/scenarios/${scenarioId}/versions/${versionId}/rollback`,
        }),
      );
    });

    it("cloning a template whose spec is now invalid is rejected", async () => {
      await getDb()("templates").insert({
        slug: "stale-template",
        name: "Stale",
        description: "A template that no longer validates",
        spec: JSON.stringify({ seed: 1 }),
        benchmark_refs: JSON.stringify({}),
      });
      expectLocatedViolations(
        await app.inject({
          method: "POST",
          url: "/api/v1/scenarios",
          payload: { name: "From stale", template_slug: "stale-template" },
        }),
      );
    });

    it("cloning a valid template returns the saved first version", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/scenarios",
        payload: { name: "From UPI", template_slug: "upi-instant-payments" },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.current_version).toEqual({ id: body.current_version_id, number: 1 });
    });

    it("launching an invalid current version is rejected", async () => {
      const { scenarioId, versionId } = await scenarioWithInvalidVersion();
      await new ScenarioRepository(getDb()).setCurrentVersion(scenarioId, versionId);
      expectLocatedViolations(
        await app.inject({
          method: "POST",
          url: `/api/v1/scenarios/${scenarioId}/runs`,
          payload: {},
        }),
      );
    });
  });
});
