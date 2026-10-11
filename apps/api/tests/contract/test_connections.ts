import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues } from "../../src/services/queues.js";
import { ConnectionRepository } from "../../src/db/repositories/connections.js";

const DATA_DIR = "/tmp/txloom-connections-contract-test";

const kafkaConfig = {
  bootstrap_servers: ["broker.example.com:9093"],
  security_protocol: "SASL_SSL",
  sasl_mechanism: "SCRAM-SHA-512",
  default_topic: "events",
};
const kafkaSecrets = { username: "alice", password: "s3cr3t-pa55" };

// Testcontainers MySQL + Redis; no worker runs, which is what the 503 case relies on.
// Run via `pnpm test:integration`.
describe("connections contract", () => {
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
    process.env.DATA_DIR = DATA_DIR;
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

  function create(body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/v1/connections", payload: body });
  }

  it("supports create, read, list, update and delete", async () => {
    const created = await create({
      type: "webhook",
      name: "crud-hook",
      config: { url: "https://hooks.example.com/x" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const fetched = await app.inject({ method: "GET", url: `/api/v1/connections/${id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({ id, type: "webhook", name: "crud-hook" });

    const listed = await app.inject({ method: "GET", url: "/api/v1/connections" });
    expect((listed.json().connections as { id: string }[]).map((c) => c.id)).toContain(id);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/connections/${id}`,
      payload: { name: "crud-hook-renamed" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().name).toBe("crud-hook-renamed");

    const deleted = await app.inject({ method: "DELETE", url: `/api/v1/connections/${id}` });
    expect(deleted.statusCode).toBe(204);
    const gone = await app.inject({ method: "GET", url: `/api/v1/connections/${id}` });
    expect(gone.statusCode).toBe(404);
  });

  describe("typed validation", () => {
    function violationPaths(response: { json(): unknown }): string[] {
      const body = response.json() as {
        error: { code: string; details: { violations: { path: string }[] } };
      };
      expect(body.error.code).toBe("invalid_connection");
      return body.error.details.violations.map((v) => v.path);
    }

    it("requires sasl_mechanism for SASL protocols", async () => {
      const { sasl_mechanism: _omit, ...withoutMechanism } = kafkaConfig;
      const response = await create({
        type: "kafka",
        name: "no-mechanism",
        config: withoutMechanism,
        secrets: kafkaSecrets,
      });
      expect(response.statusCode).toBe(400);
      expect(violationPaths(response).length).toBeGreaterThan(0);
      expect(violationPaths(response).every((p) => p.startsWith("/config"))).toBe(true);
    });

    it("rejects sasl_mechanism on non-SASL protocols", async () => {
      const response = await create({
        type: "kafka",
        name: "mechanism-without-sasl",
        config: { ...kafkaConfig, security_protocol: "SSL" },
      });
      expect(response.statusCode).toBe(400);
      expect(violationPaths(response).length).toBeGreaterThan(0);
    });

    it("allows ca_pem only with SSL or SASL_SSL", async () => {
      const plaintext = await create({
        type: "kafka",
        name: "ca-on-plaintext",
        config: {
          bootstrap_servers: ["broker.example.com:9092"],
          security_protocol: "PLAINTEXT",
          default_topic: "events",
          ca_pem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
        },
      });
      expect(plaintext.statusCode).toBe(400);

      const ssl = await create({
        type: "kafka",
        name: "ca-on-ssl",
        config: {
          bootstrap_servers: ["broker.example.com:9093"],
          security_protocol: "SSL",
          default_topic: "events",
          ca_pem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
        },
      });
      expect(ssl.statusCode).toBe(201);
    });

    it("validates the topic against its regex", async () => {
      const response = await create({
        type: "kafka",
        name: "bad-topic",
        config: { ...kafkaConfig, default_topic: "has spaces/and slashes" },
        secrets: kafkaSecrets,
      });
      expect(response.statusCode).toBe(400);
      expect(violationPaths(response)).toContain("/config/default_topic");
    });

    it("reports JSON-Pointer violations for a malformed name", async () => {
      const response = await create({
        type: "webhook",
        name: "Not Valid",
        config: { url: "https://hooks.example.com/x" },
      });
      expect(response.statusCode).toBe(400);
      expect(violationPaths(response)).toContain("/name");
    });
  });

  it("returns 409 name_taken for a duplicate name", async () => {
    const body = {
      type: "webhook",
      name: "dup-name",
      config: { url: "https://hooks.example.com/d" },
    };
    expect((await create(body)).statusCode).toBe(201);
    const second = await create(body);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("name_taken");
  });

  describe("secrets", () => {
    it("never appears in any response, only has_credentials", async () => {
      const created = await create({
        type: "kafka",
        name: "secret-kafka",
        config: kafkaConfig,
        secrets: kafkaSecrets,
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;
      expect(created.json().has_credentials).toBe(true);

      const fetched = await app.inject({ method: "GET", url: `/api/v1/connections/${id}` });
      const listed = await app.inject({ method: "GET", url: "/api/v1/connections" });
      for (const response of [created, fetched, listed]) {
        expect(response.body).not.toContain(kafkaSecrets.password);
        expect(response.body).not.toContain(kafkaSecrets.username);
      }
    });

    it("keeps secrets when PATCH omits them and clears them on null", async () => {
      const created = await create({
        type: "kafka",
        name: "patch-secrets",
        config: kafkaConfig,
        secrets: kafkaSecrets,
      });
      const id = created.json().id as string;

      const renamed = await app.inject({
        method: "PATCH",
        url: `/api/v1/connections/${id}`,
        payload: { config: { ...kafkaConfig, default_topic: "events-v2" } },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().has_credentials).toBe(true);

      const cleared = await app.inject({
        method: "PATCH",
        url: `/api/v1/connections/${id}`,
        payload: { secrets: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().has_credentials).toBe(false);
    });
  });

  it("warns about localhost addresses", async () => {
    const created = await create({
      type: "kafka",
      name: "local-kafka",
      config: {
        bootstrap_servers: ["localhost:9092"],
        security_protocol: "PLAINTEXT",
        default_topic: "events",
      },
    });
    expect(created.statusCode).toBe(201);
    const warnings = created.json().warnings as { code: string }[];
    expect(warnings.map((w) => w.code)).toContain("localhost_address");
  });

  it("returns 410 gone for the removed /sinks routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/sinks" });
    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe("gone");
  });

  describe("testing", () => {
    it("POST /connections/test persists nothing and returns 503 when no worker consumes the queue", async () => {
      const before = await getDb()("connections").count({ n: "*" }).first();
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/connections/test",
        payload: {
          type: "webhook",
          name: "ephemeral",
          config: { url: "https://hooks.example.com/e" },
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("worker_unavailable");
      const after = await getDb()("connections").count({ n: "*" }).first();
      expect(after?.n).toEqual(before?.n);
    }, 30_000);

    it("lets a connection save after a missing-topic test and carries the topic_missing warning", async () => {
      // The probe itself needs a broker; here the stored test result is what the API reads,
      // so record the result a worker would have produced for a missing, non-auto-created topic.
      const created = await create({
        type: "kafka",
        name: "missing-topic",
        config: { ...kafkaConfig, default_topic: "not-there-yet" },
        secrets: kafkaSecrets,
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;

      await new ConnectionRepository(getDb(), DATA_DIR).recordTestResult(id, {
        ok: false,
        stage: "topic",
        detail: 'Topic "not-there-yet" does not exist and auto-creation is disabled',
        latency_ms: 12,
        topic: { name: "not-there-yet", exists: false, auto_create_allowed: false },
      } as never);

      const fetched = await app.inject({ method: "GET", url: `/api/v1/connections/${id}` });
      expect(fetched.statusCode).toBe(200);
      const warnings = fetched.json().warnings as { code: string }[];
      expect(warnings.map((w) => w.code)).toContain("topic_missing");

      const resaved = await app.inject({
        method: "PATCH",
        url: `/api/v1/connections/${id}`,
        payload: { name: "missing-topic-saved" },
      });
      expect(resaved.statusCode).toBe(200);
    });
  });

  describe("GET /connections/suggestions", () => {
    it("returns the suggestions array, empty when no local broker is detected", async () => {
      const saved = process.env.TXLOOM_LOCAL_KAFKA;
      process.env.TXLOOM_LOCAL_KAFKA = "127.0.0.1:1";
      try {
        const response = await app.inject({
          method: "GET",
          url: "/api/v1/connections/suggestions",
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ suggestions: [] });
      } finally {
        if (saved === undefined) delete process.env.TXLOOM_LOCAL_KAFKA;
        else process.env.TXLOOM_LOCAL_KAFKA = saved;
      }
    });

    it("returns a local_kafka suggestion when the probe succeeds and no connection points at it, and nothing once one does", async () => {
      const broker = createServer((socket) => socket.end());
      await new Promise<void>((resolve) => broker.listen(0, "127.0.0.1", resolve));
      const port = (broker.address() as { port: number }).port;
      const saved = process.env.TXLOOM_LOCAL_KAFKA;
      process.env.TXLOOM_LOCAL_KAFKA = `127.0.0.1:${port}`;
      try {
        const before = (
          await app.inject({ method: "GET", url: "/api/v1/connections/suggestions" })
        ).json();
        expect(before.suggestions).toHaveLength(1);
        expect(before.suggestions[0]).toMatchObject({
          kind: "local_kafka",
          input: {
            type: "kafka",
            config: { bootstrap_servers: [`127.0.0.1:${port}`], security_protocol: "PLAINTEXT" },
          },
        });

        const created = await create({
          type: "kafka",
          name: "points-at-local",
          config: {
            bootstrap_servers: [`127.0.0.1:${port}`],
            security_protocol: "PLAINTEXT",
            default_topic: "txloom.events",
          },
        });
        expect(created.statusCode).toBe(201);
        const after = (
          await app.inject({ method: "GET", url: "/api/v1/connections/suggestions" })
        ).json();
        expect(after.suggestions).toEqual([]);
      } finally {
        if (saved === undefined) delete process.env.TXLOOM_LOCAL_KAFKA;
        else process.env.TXLOOM_LOCAL_KAFKA = saved;
        await new Promise<void>((resolve) => broker.close(() => resolve()));
      }
    });
  });
});
