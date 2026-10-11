import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues, getQueues } from "../../src/services/queues.js";
import { ConnectionRepository } from "../../src/db/repositories/connections.js";
import { tinySpec } from "../support/tiny-spec.js";

const DATA_DIR = "/tmp/txloom-launch-contract-test";
const DAY_MS = 24 * 60 * 60 * 1000;

// Testcontainers MySQL + Redis. Run via `pnpm test:integration`.
describe("launch contract", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let kafkaConnectionId: string;
  let webhookConnectionId: string;

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

    const kafka = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      payload: {
        type: "kafka",
        name: "launch-kafka",
        config: {
          bootstrap_servers: ["broker.example.com:9092"],
          security_protocol: "PLAINTEXT",
          default_topic: "events",
        },
      },
    });
    kafkaConnectionId = kafka.json().id;
    const webhook = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      payload: {
        type: "webhook",
        name: "launch-hook",
        config: { url: "https://hooks.example.com/l" },
      },
    });
    webhookConnectionId = webhook.json().id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
  });

  /** A scenario whose spec has a file sink plus the named extra sinks. */
  async function scenario(
    label: string,
    extraSinks: { type: string; name: string }[],
    clock: { days?: number; then_stream_tps?: number | null } = {},
  ): Promise<string> {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: `Launch ${label}`, currency: "INR" },
    });
    const scenarioId = created.json().id as string;
    const spec = tinySpec({ days: clock.days ?? 3 });
    spec.output.sinks.push(...(extraSinks as never[]));
    if (clock.then_stream_tps === null) {
      delete (spec.clock as { then_stream_tps?: number }).then_stream_tps;
    } else if (clock.then_stream_tps !== undefined) {
      spec.clock.then_stream_tps = clock.then_stream_tps;
    }
    const saved = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/versions`,
      payload: { spec },
    });
    expect(saved.statusCode).toBe(201);
    return scenarioId;
  }

  async function launch(scenarioId: string, payload: Record<string, unknown>) {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload,
    });
    // No worker runs here; drop the generation jobs so they don't pile up.
    await getQueues().generatePartition.obliterate({ force: true });
    return response;
  }

  describe("defaults", () => {
    it("uses history_then_live when any destination is a broker", async () => {
      const id = await scenario("mode-broker", [{ type: "kafka", name: "events" }]);
      const response = await launch(id, {
        destinations: [{ sink: "events", connection_id: kafkaConnectionId }],
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().mode).toBe("history_then_live");
    });

    it("uses history_only when the spec has no broker destination", async () => {
      const id = await scenario("mode-file", []);
      const response = await launch(id, {});
      expect(response.statusCode).toBe(201);
      expect(response.json().mode).toBe("history_only");
    });

    it("treats a webhook destination as a broker destination for the mode default", async () => {
      const id = await scenario("mode-webhook", [{ type: "webhook", name: "hook" }]);
      const response = await launch(id, {
        destinations: [{ sink: "hook", connection_id: webhookConnectionId }],
      });
      expect(response.json().mode).toBe("history_then_live");
    });

    it("honours an explicit mode over the default", async () => {
      const id = await scenario("mode-explicit", [{ type: "kafka", name: "events" }]);
      const response = await launch(id, {
        mode: "history_only",
        destinations: [{ sink: "events", connection_id: kafkaConnectionId }],
      });
      expect(response.json().mode).toBe("history_only");
    });

    it("defaults target_tps to spec.clock.then_stream_tps, else 50", async () => {
      const withRate = await scenario("tps-spec", [], { then_stream_tps: 120 });
      expect((await launch(withRate, {})).json().target_tps).toBe(120);

      const withoutRate = await scenario("tps-default", [], { then_stream_tps: null });
      expect((await launch(withoutRate, {})).json().target_tps).toBe(50);

      const explicit = await scenario("tps-explicit", [], { then_stream_tps: 120 });
      expect((await launch(explicit, { target_tps: 300 })).json().target_tps).toBe(300);
    });

    it("defaults label_channel to spec.output.stream_label_channel ?? false", async () => {
      const plain = await scenario("label-default", []);
      expect((await launch(plain, {})).json().label_channel).toBe(false);
      expect((await launch(plain, { label_channel: true })).json().label_channel).toBe(true);
    });
  });

  describe("launch-defaults", () => {
    it("drops sinks renamed out of the current spec", async () => {
      const id = await scenario("renamed", [{ type: "kafka", name: "events" }]);
      await launch(id, { destinations: [{ sink: "events", connection_id: kafkaConnectionId }] });
      const before = await app.inject({
        method: "GET",
        url: `/api/v1/scenarios/${id}/launch-defaults`,
      });
      expect(before.json().destinations.map((d: { sink: string }) => d.sink)).toEqual(["events"]);

      // Rename the sink in a new spec version.
      const spec = tinySpec();
      spec.output.sinks.push({ type: "kafka", name: "renamed-events" } as never);
      await app.inject({
        method: "POST",
        url: `/api/v1/scenarios/${id}/versions`,
        payload: { spec },
      });
      const after = await app.inject({
        method: "GET",
        url: `/api/v1/scenarios/${id}/launch-defaults`,
      });
      expect(after.json().destinations).toEqual([]);
    });

    it("prefills mode, rate, replay and label channel from the last launch", async () => {
      const id = await scenario("prefill", [{ type: "kafka", name: "events" }]);
      const fresh = await app.inject({
        method: "GET",
        url: `/api/v1/scenarios/${id}/launch-defaults`,
      });
      expect(fresh.json()).toMatchObject({
        destinations: [],
        mode: "history_only",
        replay_history: false,
        label_channel: false,
      });

      const response = await launch(id, {
        mode: "history_then_live",
        target_tps: 75,
        replay_history: true,
        label_channel: true,
        destinations: [{ sink: "events", connection_id: kafkaConnectionId, topic: "events-v2" }],
      });
      expect(response.statusCode).toBe(201);

      const defaults = await app.inject({
        method: "GET",
        url: `/api/v1/scenarios/${id}/launch-defaults`,
      });
      expect(defaults.json()).toMatchObject({
        mode: "history_then_live",
        target_tps: 75,
        replay_history: true,
        label_channel: true,
      });
      expect(defaults.json().destinations).toEqual([
        expect.objectContaining({
          sink: "events",
          connection_id: kafkaConnectionId,
          topic: "events-v2",
        }),
      ]);
    });

    it("does not change the remembered settings when the launch is rejected", async () => {
      const id = await scenario("rejected", [{ type: "kafka", name: "events" }]);
      await launch(id, {
        mode: "history_then_live",
        target_tps: 80,
        destinations: [{ sink: "events", connection_id: kafkaConnectionId }],
      });
      const rejected = await launch(id, { mode: "history_only", target_tps: 5 });
      expect(rejected.statusCode).toBe(400);
      const defaults = await app.inject({
        method: "GET",
        url: `/api/v1/scenarios/${id}/launch-defaults`,
      });
      expect(defaults.json()).toMatchObject({ mode: "history_then_live", target_tps: 80 });
    });
  });

  describe("retention warning", () => {
    async function recordRetention(connectionId: string, retentionMs: number | null) {
      await new ConnectionRepository(getDb(), DATA_DIR).recordTestResult(connectionId, {
        ok: true,
        stage: "done",
        detail: "Connected.",
        latency_ms: 5,
        topic: { name: "events", exists: true, partitions: 3, retention_ms: retentionMs },
      } as never);
    }

    it("returns 201 with a retention_shorter_than_history warning when replaying into a shorter-lived topic", async () => {
      await recordRetention(kafkaConnectionId, 2 * DAY_MS);
      const id = await scenario("retention-short", [{ type: "kafka", name: "events" }], {
        days: 10,
      });
      const response = await launch(id, {
        replay_history: true,
        destinations: [{ sink: "events", connection_id: kafkaConnectionId }],
      });
      expect(response.statusCode).toBe(201);
      const warnings = response.json().warnings as { code: string; details?: { sink?: string } }[];
      expect(warnings.map((w) => w.code)).toContain("retention_shorter_than_history");
      expect(warnings.find((w) => w.code === "retention_shorter_than_history")?.details?.sink).toBe(
        "events",
      );
    });

    it("adds no warning when retention covers the window, is unknown, or replay is off", async () => {
      const id = await scenario("retention-ok", [{ type: "kafka", name: "events" }], { days: 10 });
      const destinations = [{ sink: "events", connection_id: kafkaConnectionId }];

      await recordRetention(kafkaConnectionId, 30 * DAY_MS);
      expect(
        (await launch(id, { replay_history: true, destinations })).json().warnings ?? [],
      ).toEqual([]);

      await recordRetention(kafkaConnectionId, null);
      expect(
        (await launch(id, { replay_history: true, destinations })).json().warnings ?? [],
      ).toEqual([]);

      await recordRetention(kafkaConnectionId, 2 * DAY_MS);
      expect(
        (await launch(id, { replay_history: false, destinations })).json().warnings ?? [],
      ).toEqual([]);
    });
  });
});
