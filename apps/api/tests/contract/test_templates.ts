import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";

const GALLERY_SLUGS = [
  "upi-instant-payments",
  "card-present-retail",
  "mobile-money",
  "marketplace-payouts",
];

// Testcontainers MySQL — GET /templates (the seeded gallery, FR-006/007) and
// POST /scenarios {template_slug} clone-into-scenario. Run via
// `pnpm test:integration`.
describe("templates contract", () => {
  let mysql: StartedTestContainer;
  let app: FastifyInstance;

  beforeAll(async () => {
    mysql = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();
    process.env.DATABASE_URL = `mysql://root:test@${mysql.getHost()}:${mysql.getMappedPort(3306)}/txloom_test`;
    await getDb().migrate.latest();
    app = await buildApp();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeDb();
    await mysql?.stop();
  });

  it("GET /templates returns the four seeded gallery templates with benchmark_refs", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/templates" });
    expect(response.statusCode).toBe(200);
    const slugs = response
      .json()
      .templates.map((t: { slug: string }) => t.slug)
      .sort();
    expect(slugs).toEqual([...GALLERY_SLUGS].sort());
    for (const template of response.json().templates) {
      expect(template.spec).toBeTruthy();
      expect(template.benchmark_refs).toBeTruthy();
    }
  });

  it("POST /scenarios {template_slug} clones the template's spec into the new scenario's first version", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: "From UPI template", template_slug: "upi-instant-payments" },
    });
    expect(response.statusCode).toBe(201);
    const scenario = response.json();
    expect(scenario.template_slug).toBe("upi-instant-payments");
    expect(scenario.current_version_id).toBeTruthy();
    expect(scenario.currency).toBe("INR");

    const versionsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/scenarios/${scenario.id}/versions`,
    });
    expect(versionsResponse.json().versions.length).toBe(1);
    expect(versionsResponse.json().versions[0].spec.channel).toBe("upi");
  });

  it("POST /scenarios {template_slug} 404s for an unknown slug", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: "Bad clone", template_slug: "nonexistent-template" },
    });
    expect(response.statusCode).toBe(404);
  });
});
