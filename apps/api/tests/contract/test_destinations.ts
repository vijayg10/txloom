import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues, getQueues } from "../../src/services/queues.js";
import { RunDestinationRepository } from "../../src/db/repositories/run-destinations.js";
import { tinySpec } from "../support/tiny-spec.js";

// Testcontainers MySQL + Redis. Run via `pnpm test:integration`.
describe("destinations contract", () => {
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
    process.env.DATA_DIR = "/tmp/txloom-destinations-contract-test";
    await getDb().migrate.latest();
    app = await buildApp();

    const kafka = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      payload: {
        type: "kafka",
        name: "dest-kafka",
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
        name: "dest-hook",
        config: { url: "https://hooks.example.com/d" },
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

  /** A scenario whose spec has a file sink plus one kafka sink named "events". */
  async function scenarioWithKafkaSink(label: string): Promise<string> {
    const scenario = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: `Destinations ${label}`, currency: "INR" },
    });
    const scenarioId = scenario.json().id as string;
    const spec = tinySpec();
    spec.output.sinks.push({ type: "kafka", name: "events" } as never);
    const saved = await app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/versions`,
      payload: { spec },
    });
    expect(saved.statusCode).toBe(201);
    return scenarioId;
  }

  function launch(scenarioId: string, payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: `/api/v1/scenarios/${scenarioId}/runs`, payload });
  }

  it("rejects a non-file sink launched without a destination", async () => {
    const scenarioId = await scenarioWithKafkaSink("missing");
    const response = await launch(scenarioId, {});
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: "sink_without_destination",
      details: { sink: "events" },
    });
  });

  it("rejects a kafka sink bound to a webhook connection", async () => {
    const scenarioId = await scenarioWithKafkaSink("mismatch");
    const response = await launch(scenarioId, {
      destinations: [{ sink: "events", connection_id: webhookConnectionId }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: "destination_type_mismatch",
      details: { sink: "events" },
    });
  });

  it("rejects an unknown connection_id", async () => {
    const scenarioId = await scenarioWithKafkaSink("unknown");
    const response = await launch(scenarioId, {
      destinations: [{ sink: "events", connection_id: "00000000-0000-0000-0000-000000000000" }],
    });
    expect(response.statusCode).toBe(400);
  });

  it("persists destinations with name and type snapshots, and serves them as launch defaults", async () => {
    const scenarioId = await scenarioWithKafkaSink("persist");
    const response = await launch(scenarioId, {
      destinations: [{ sink: "events", connection_id: kafkaConnectionId, topic: "events-alt" }],
    });
    expect(response.statusCode).toBe(201);
    const runId = response.json().id as string;
    await getQueues().generatePartition.obliterate({ force: true });

    const rows = await new RunDestinationRepository(getDb()).listByRun(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sink_name: "events",
      connection_id: kafkaConnectionId,
      connection_name: "dest-kafka",
      connection_type: "kafka",
      topic: "events-alt",
    });

    const defaults = await app.inject({
      method: "GET",
      url: `/api/v1/scenarios/${scenarioId}/launch-defaults`,
    });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().destinations).toEqual([
      expect.objectContaining({
        sink: "events",
        connection_id: kafkaConnectionId,
        connection_name: "dest-kafka",
        connection_type: "kafka",
        topic: "events-alt",
        connection_missing: false,
      }),
    ]);
  });

  it("rejects an inline sink on stream/start", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/runs/00000000-0000-0000-0000-000000000000/stream/start",
      payload: { sink: { type: "kafka", brokers: ["localhost:9092"], topic: "x" } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("inline_sink_removed");
  });

  it("returns 409 destination_connection_missing when a destination's connection was deleted", async () => {
    const doomed = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      payload: {
        type: "kafka",
        name: "doomed-kafka",
        config: {
          bootstrap_servers: ["broker.example.com:9092"],
          security_protocol: "PLAINTEXT",
          default_topic: "events",
        },
      },
    });
    const doomedId = doomed.json().id as string;
    const scenarioId = await scenarioWithKafkaSink("deleted");
    const response = await launch(scenarioId, {
      destinations: [{ sink: "events", connection_id: doomedId }],
    });
    expect(response.statusCode).toBe(201);
    const runId = response.json().id as string;
    await getQueues().generatePartition.obliterate({ force: true });
    await getDb()("run_partitions").where({ run_id: runId }).update({ state: "done" });
    await getDb()("runs").where({ id: runId }).update({ status: "completed" });

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/connections/${doomedId}` });
    expect(removed.statusCode).toBe(204);

    const start = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/stream/start`,
      payload: { target_tps: 10 },
    });
    expect(start.statusCode).toBe(409);
    expect(start.json().error).toMatchObject({
      code: "destination_connection_missing",
      details: { sink: "events" },
    });
  });

  describe("PUT /runs/:id/stream/destinations", () => {
    async function streamingRun(): Promise<{ runId: string; scenarioId: string; otherId: string }> {
      const other = await app.inject({
        method: "POST",
        url: "/api/v1/connections",
        payload: {
          type: "webhook",
          name: `dest-other-${Math.random().toString(36).slice(2, 8)}`,
          config: { url: "https://hooks.example.com/other" },
        },
      });
      const scenario = await app.inject({
        method: "POST",
        url: "/api/v1/scenarios",
        payload: {
          name: `Change destination ${Math.random().toString(36).slice(2, 8)}`,
          currency: "INR",
        },
      });
      const scenarioId = scenario.json().id as string;
      const spec = tinySpec();
      spec.output.sinks.push({ type: "webhook", name: "live" } as never);
      await app.inject({
        method: "POST",
        url: `/api/v1/scenarios/${scenarioId}/versions`,
        payload: { spec },
      });
      const launch = await app.inject({
        method: "POST",
        url: `/api/v1/scenarios/${scenarioId}/runs`,
        payload: {
          mode: "history_only",
          destinations: [{ sink: "live", connection_id: webhookConnectionId }],
        },
      });
      const runId = launch.json().id as string;
      await getQueues().generatePartition.obliterate({ force: true });
      await getDb()("run_partitions").where({ run_id: runId }).update({ state: "done" });
      await getDb()("runs").where({ id: runId }).update({ status: "completed" });
      const started = await app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/stream/start`,
        payload: { target_tps: 10 },
      });
      expect(started.statusCode).toBe(200);
      return { runId, scenarioId, otherId: other.json().id as string };
    }

    const put = (runId: string, destinations: unknown) =>
      app.inject({
        method: "PUT",
        url: `/api/v1/runs/${runId}/stream/destinations`,
        payload: { destinations },
      });

    it("returns 409 stream_active while a session is streaming, paused or error", async () => {
      const { runId, otherId } = await streamingRun();
      const destinations = [{ sink: "live", connection_id: otherId }];

      const streaming = await put(runId, destinations);
      expect(streaming.statusCode).toBe(409);
      expect(streaming.json().error.code).toBe("stream_active");

      await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/stream/pause` });
      expect((await put(runId, destinations)).json().error.code).toBe("stream_active");

      const stream = await getDb()("streams").where({ run_id: runId }).first();
      await getDb()("streams").where({ id: stream.id }).update({ state: "error" });
      expect((await put(runId, destinations)).json().error.code).toBe("stream_active");
    });

    it("succeeds when stopped; the launch record is untouched and the next session snapshots the new destination", async () => {
      const { runId, otherId } = await streamingRun();
      await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/stream/stop` });

      const changed = await put(runId, [{ sink: "live", connection_id: otherId }]);
      expect(changed.statusCode).toBe(200);
      expect(changed.json().destinations).toEqual([
        expect.objectContaining({ sink: "live", connection_id: otherId }),
      ]);

      // The run still reports where it was launched.
      const run = (await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` })).json();
      expect(run.launch_destinations).toEqual([
        expect.objectContaining({ sink: "live", connection_id: webhookConnectionId }),
      ]);
      const rows = await new RunDestinationRepository(getDb()).listByRun(runId);
      expect(rows.map((r) => r.connection_id)).toEqual([webhookConnectionId]);

      const restarted = await app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/stream/start`,
        payload: {},
      });
      expect(restarted.statusCode).toBe(200);
      const { sessions } = (
        await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/stream/sessions` })
      ).json();
      expect(sessions).toHaveLength(2);
      expect(sessions[1].destinations_snapshot).toEqual([
        expect.objectContaining({ sink: "live", connection_id: otherId }),
      ]);
      expect(sessions[0].destinations_snapshot[0].connection_id).toBe(webhookConnectionId);
    });

    it("validates the new destinations like a launch", async () => {
      const { runId } = await streamingRun();
      await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/stream/stop` });
      const missing = await put(runId, []);
      expect(missing.statusCode).toBe(400);
      expect(missing.json().error.code).toBe("sink_without_destination");
      const kafka = await put(runId, [{ sink: "live", connection_id: kafkaConnectionId }]);
      expect(kafka.json().error.code).toBe("destination_type_mismatch");
      expect((await put("00000000-0000-0000-0000-000000000000", [])).statusCode).toBe(404);
    });
  });
});
