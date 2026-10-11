import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues } from "../../src/services/queues.js";
import {
  applyEnvConnections,
  probeLocalKafka,
  seedOnBoot,
  suggestions,
} from "../../src/services/local-kafka.js";

// The bundled demo broker is detected, seeded once as `local-kafka`, and offered as a suggestion
// while it isn't registered (FR-013). The broker is a plain TCP listener standing in for
// `kafka:29092`, reached through the TXLOOM_LOCAL_KAFKA override. Run via `pnpm test:integration`.
describe("local Kafka detection and env connections", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let fakeBroker: Server;
  let dataDir: string;

  const connectionsNamed = (name: string) => getDb()("connections").where({ name });

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
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-local-kafka-"));
    process.env.DATA_DIR = dataDir;
    fakeBroker = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => fakeBroker.listen(0, "127.0.0.1", resolve));
    const address = fakeBroker.address();
    if (!address || typeof address === "string") throw new Error("no address");
    process.env.TXLOOM_LOCAL_KAFKA = `127.0.0.1:${address.port}`;
    await getDb().migrate.latest();
    app = await buildApp();
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => fakeBroker?.close(() => resolve()));
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("probes a reachable broker, and reports an unreachable one as absent", async () => {
    expect(await probeLocalKafka()).toBe(true);
    const saved = process.env.TXLOOM_LOCAL_KAFKA;
    process.env.TXLOOM_LOCAL_KAFKA = "127.0.0.1:1";
    try {
      expect(await probeLocalKafka()).toBe(false);
    } finally {
      process.env.TXLOOM_LOCAL_KAFKA = saved;
    }
  });

  it("GET /connections/suggestions offers the local broker while it is unregistered", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/connections/suggestions" });
    expect(response.statusCode).toBe(200);
    const [suggestion] = response.json().suggestions;
    expect(suggestion).toMatchObject({
      kind: "local_kafka",
      input: { type: "kafka", name: "local-kafka", config: { default_topic: "txloom.events" } },
    });
    expect(typeof suggestion.detail).toBe("string");
  });

  it("seeds local-kafka (managed_by auto) once at boot, and the suggestion goes away", async () => {
    await seedOnBoot(getDb(), dataDir);
    await seedOnBoot(getDb(), dataDir); // a second boot changes nothing
    const rows = await connectionsNamed("local-kafka");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "kafka", managed_by: "auto" });

    const response = await app.inject({ method: "GET", url: "/api/v1/connections/suggestions" });
    expect(response.json().suggestions).toEqual([]);
    expect(await suggestions(getDb())).toEqual([]);
  });

  it("does not re-seed after the user deletes it, and offers it as a suggestion again", async () => {
    const [row] = await connectionsNamed("local-kafka");
    const removed = await app.inject({ method: "DELETE", url: `/api/v1/connections/${row.id}` });
    expect(removed.statusCode).toBe(204);

    await seedOnBoot(getDb(), dataDir); // "reboot"
    expect(await connectionsNamed("local-kafka")).toHaveLength(0);
    const response = await app.inject({ method: "GET", url: "/api/v1/connections/suggestions" });
    expect(response.json().suggestions).toHaveLength(1);
  });

  it("seeds nothing while the broker is unreachable, so a later boot can still seed it", async () => {
    await getDb()("settings").where({ key: "local_kafka_seeded" }).delete();
    const saved = process.env.TXLOOM_LOCAL_KAFKA;
    process.env.TXLOOM_LOCAL_KAFKA = "127.0.0.1:1";
    try {
      await seedOnBoot(getDb(), dataDir);
      expect(await connectionsNamed("local-kafka")).toHaveLength(0);
    } finally {
      process.env.TXLOOM_LOCAL_KAFKA = saved;
    }
    await seedOnBoot(getDb(), dataDir);
    expect(await connectionsNamed("local-kafka")).toHaveLength(1);
  });

  describe("TXLOOM_CONNECTIONS_JSON", () => {
    const hook = (url: string) =>
      JSON.stringify([{ type: "webhook", name: "env-hook", config: { url } }]);

    it("upserts by name with managed_by env, and updates the config on a later boot", async () => {
      await applyEnvConnections(getDb(), dataDir, hook("https://hooks.example.com/one"));
      let rows = await connectionsNamed("env-hook");
      expect(rows).toHaveLength(1);
      expect(rows[0].managed_by).toBe("env");

      await applyEnvConnections(getDb(), dataDir, hook("https://hooks.example.com/two"));
      rows = await connectionsNamed("env-hook");
      expect(rows).toHaveLength(1);
      const config =
        typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : rows[0].config;
      expect(config.url).toBe("https://hooks.example.com/two");
    });

    it("cannot be edited or deleted through the API", async () => {
      const [row] = await connectionsNamed("env-hook");
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/connections/${row.id}`,
        payload: { name: "renamed" },
      });
      expect(patch.statusCode).toBe(403);
      expect(patch.json().error.code).toBe("managed_connection");
      const removed = await app.inject({ method: "DELETE", url: `/api/v1/connections/${row.id}` });
      expect(removed.statusCode).toBe(403);
    });

    it("rejects invalid entries without touching the others", async () => {
      await expect(
        applyEnvConnections(
          getDb(),
          dataDir,
          JSON.stringify([{ type: "webhook", name: "Bad Name", config: {} }]),
        ),
      ).rejects.toThrow(/TXLOOM_CONNECTIONS_JSON/);
      await expect(applyEnvConnections(getDb(), dataDir, "not json")).rejects.toThrow(
        /TXLOOM_CONNECTIONS_JSON/,
      );
    });
  });
});
