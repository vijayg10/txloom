import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues } from "../../src/services/queues.js";
import { tinySpec } from "../support/tiny-spec.js";

// Testcontainers MySQL (the estimate reads the stored generation throughput) + Redis.
// Run via `pnpm test:integration`.
describe("POST /spec/estimate", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;

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
    process.env.DATA_DIR = "/tmp/txloom-estimate-contract-test";
    await getDb().migrate.latest();
    app = await buildApp();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
  });

  function estimate(payload: unknown) {
    return app.inject({ method: "POST", url: "/api/v1/spec/estimate", payload });
  }

  function brokerSpec() {
    const spec = tinySpec({ consumers: 200, days: 10 });
    spec.output.sinks.push({ type: "kafka", name: "events" } as never);
    return spec;
  }

  async function tableCounts() {
    const counts: Record<string, number> = {};
    for (const table of ["scenarios", "runs", "settings", "connections"]) {
      const row = await getDb()(table).count({ n: "*" }).first();
      counts[table] = Number(row?.n ?? 0);
    }
    return counts;
  }

  it("returns the RunEstimate shape", async () => {
    const response = await estimate({ spec: tinySpec() });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(
      [
        "assumptions",
        "generation_seconds",
        "history_events",
        "partitions",
        "replay_messages",
      ].sort(),
    );
    expect(body.history_events).toBeGreaterThan(0);
    expect(body.partitions).toBeGreaterThanOrEqual(1);
    expect(body.generation_seconds).toBeGreaterThan(0);
    expect(Array.isArray(body.assumptions)).toBe(true);
    expect(body.replay_messages).toBe(0);
  });

  it("is side-effect-free", async () => {
    const before = await tableCounts();
    await estimate({ spec: brokerSpec(), replay_history: true });
    await estimate({ spec: { not: "a spec" } });
    expect(await tableCounts()).toEqual(before);
  });

  it("returns 400 spec_invalid with located violations for an invalid spec", async () => {
    const response = await estimate({ spec: { seed: 1 } });
    expect(response.statusCode).toBe(400);
    const error = response.json().error;
    expect(error.code).toBe("spec_invalid");
    expect(error.details.violations.length).toBeGreaterThan(0);
    expect(error.details.violations[0]).toHaveProperty("path");
  });

  it("returns 400 spec_invalid when the body has no spec", async () => {
    const response = await estimate({});
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("spec_invalid");
  });

  it("makes replay_messages greater than 0 with replay_history on a spec with a broker sink", async () => {
    const off = await estimate({ spec: brokerSpec() });
    const on = await estimate({ spec: brokerSpec(), replay_history: true });
    expect(off.json().replay_messages).toBe(0);
    expect(on.json().replay_messages).toBeGreaterThan(0);
    expect(on.json().replay_messages).toBeGreaterThanOrEqual(on.json().history_events);
  });

  it("reads the stored generation throughput", async () => {
    const baseline = (await estimate({ spec: brokerSpec() })).json();
    await getDb()("settings")
      .insert({ key: "generation_throughput", value: JSON.stringify(1000) })
      .onConflict("key")
      .merge();
    const slow = (await estimate({ spec: brokerSpec() })).json();
    expect(slow.generation_seconds).toBeGreaterThan(baseline.generation_seconds * 10);
    expect(slow.assumptions.join(" ")).toContain("1,000");
  });
});
