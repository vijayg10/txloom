import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import knexFactory, { type Knex } from "knex";

// Testcontainers MySQL — every foundational table must migrate up and down cleanly.
// Run via `pnpm test:integration` (requires a local Docker daemon).

const EXPECTED_TABLES = [
  "scenarios",
  "spec_versions",
  "runs",
  "run_partitions",
  "streams",
  "sink_connections",
  "templates",
  "settings",
];

describe("Knex migration round-trip (Testcontainers MySQL)", () => {
  let container: StartedTestContainer;
  let db: Knex;

  beforeAll(async () => {
    container = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();

    db = knexFactory({
      client: "mysql2",
      connection: {
        host: container.getHost(),
        port: container.getMappedPort(3306),
        user: "root",
        password: "test",
        database: "txloom_test",
        charset: "utf8mb4",
      },
      migrations: { directory: "../src/db/migrations" },
    });
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it("migrates every foundational table up cleanly", async () => {
    await db.migrate.latest();
    for (const table of EXPECTED_TABLES) {
      expect(await db.schema.hasTable(table)).toBe(true);
    }
  });

  it("migrates back down cleanly, dropping every foundational table", async () => {
    await db.migrate.rollback(undefined, true);
    for (const table of EXPECTED_TABLES) {
      expect(await db.schema.hasTable(table)).toBe(false);
    }
  });

  it("re-migrating up after a full rollback reaches the same schema", async () => {
    await db.migrate.latest();
    for (const table of EXPECTED_TABLES) {
      expect(await db.schema.hasTable(table)).toBe(true);
    }
  });
});
