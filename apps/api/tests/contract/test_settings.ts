import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";

// Testcontainers MySQL — GET/PUT /settings (global defaults). Run via
// `pnpm test:integration`.
describe("settings contract", () => {
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

  it("GET /settings is an empty object on a fresh install", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({});
  });

  it("PUT /settings upserts new keys", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/settings",
      payload: { "defaults.currency": "INR" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()["defaults.currency"]).toBe("INR");
  });

  it("PUT /settings updates existing keys without disturbing others", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/v1/settings",
      payload: { "defaults.locale": "en-IN" },
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/settings",
      payload: { "defaults.currency": "USD" },
    });
    expect(response.json()["defaults.currency"]).toBe("USD");
    expect(response.json()["defaults.locale"]).toBe("en-IN");
  });
});
