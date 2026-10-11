import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import { ENGINE_VERSION } from "@txloom/engine";
import { kafkaSinkFactory, listPartSegments, readParquet, webhookSinkFactory } from "@txloom/sinks";
import type {
  DeliveryCursor,
  DeliveryState,
  RunDeliveryRow,
} from "../../../api/src/db/repositories/run-deliveries.js";
import { runDelivery, type DeliverDeps } from "../../src/jobs/deliver.js";
import runPartition from "../../src/pool/partition-worker.js";
import { tinySpec } from "../../../api/tests/support/tiny-spec.js";

/** An in-memory stand-in for the `run_deliveries` table. */
function fakeDeliveries() {
  const rows = new Map<string, RunDeliveryRow>();
  const key = (runId: string, sink: string) => `${runId}/${sink}`;
  const store: DeliverDeps["deliveries"] & { rows: typeof rows } = {
    rows,
    async get(runId, sink) {
      return rows.get(key(runId, sink));
    },
    async markRunning(runId, sink, total) {
      const row = rows.get(key(runId, sink)) ?? {
        run_id: runId,
        sink_name: sink,
        state: "pending" as DeliveryState,
        cursor: null,
        total: 0,
        published: 0,
        failed: 0,
        destination_snapshot: null,
        last_error: null,
        started_at: null,
        finished_at: null,
      };
      rows.set(key(runId, sink), { ...row, state: "running", total: total ?? row.total });
    },
    async recordProgress(runId, sink, progress) {
      const row = rows.get(key(runId, sink))!;
      rows.set(key(runId, sink), {
        ...row,
        cursor: progress.cursor as DeliveryCursor,
        published: progress.published,
        failed: progress.failed,
      });
    },
    async finish(runId, sink, outcome) {
      const row = rows.get(key(runId, sink))!;
      rows.set(key(runId, sink), {
        ...row,
        state: outcome.state,
        last_error: outcome.error ?? null,
      });
    },
  };
  return store;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.on("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

// History replay (FR-021) through the real deliver logic: a Testcontainers Kafka broker, and a
// webhook that always answers 500. Run via `pnpm test:integration`.
describe("history replay", () => {
  const runId = "replay-run";
  let dataDir: string;
  let kafka: StartedTestContainer;
  let brokers: string[];
  let webhook: Server;
  let webhookUrl: string;

  async function deliveredRows(sink: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (const file of await listPartSegments(
      path.join(dataDir, "runs", runId, "delivered", sink),
    )) {
      for await (const row of readParquet(file)) rows.push(row);
    }
    return rows;
  }

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-replay-"));
    const spec = tinySpec({ consumers: 8, days: 3 });
    spec.output.sinks.push(
      { type: "kafka", name: "events" } as never,
      {
        type: "webhook",
        name: "hook",
      } as never,
    );
    // Late arrival and duplicates on the broker sink, so the replay order is not just truth order.
    (spec as { imperfections: unknown }).imperfections = {
      late_arrival: {
        rate: 0.3,
        delay_seconds_mean: 3600,
        delay_seconds_stddev: 600,
        sinks: ["events"],
      },
      duplicate_delivery: { rate: 0.1, sinks: ["events"] },
    };
    await runPartition({
      spec: spec as never,
      seed: String(spec.seed),
      partitionNo: 0,
      partitionCount: 1,
      engineVersion: ENGINE_VERSION,
      runId,
      dataDir,
    });

    const port = await freePort();
    kafka = await new GenericContainer("apache/kafka:3.9.0")
      .withExposedPorts({ container: 9092, host: port })
      .withEnvironment({
        KAFKA_NODE_ID: "1",
        KAFKA_PROCESS_ROLES: "broker,controller",
        KAFKA_LISTENERS: "PLAINTEXT://:9092,CONTROLLER://:9093",
        KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://localhost:${port}`,
        KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
        KAFKA_CONTROLLER_QUORUM_VOTERS: "1@localhost:9093",
        KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
        KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: "1",
        KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1",
        KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: "1",
      })
      .start();
    brokers = [`localhost:${port}`];

    webhook = createServer((_req, res) => {
      res.statusCode = 500;
      res.end();
    });
    await new Promise<void>((resolve) => webhook.listen(0, "127.0.0.1", resolve));
    webhookUrl = `http://127.0.0.1:${(webhook.address() as { port: number }).port}`;
  }, 240_000);

  afterAll(async () => {
    webhook?.closeAllConnections();
    await new Promise<void>((resolve) => webhook?.close(() => resolve()));
    await kafka?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("publishes every delivered/events row to Kafka in delivery order, with delivered_at", async () => {
    const topic = "replay.events";
    const admin = new KafkaJS.Kafka({ kafkaJS: { brokers } }).admin();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic, numPartitions: 1 }] });
    await admin.disconnect();

    const expected = await deliveredRows("events");
    expect(expected.length).toBeGreaterThan(0);

    const deliveries = fakeDeliveries();
    await runDelivery(
      {
        connection: {} as never,
        deliveries,
        createSink: () =>
          kafkaSinkFactory.create(
            "events",
            { bootstrap_servers: brokers, security_protocol: "PLAINTEXT", default_topic: topic },
            null,
          ),
        checkpointRows: 25,
      },
      {
        runId,
        sinkName: "events",
        destination: { sink: "events", connectionId: "c1", topic },
        dataDir,
        engineVersion: ENGINE_VERSION,
      },
    );

    const row = (await deliveries.get(runId, "events"))!;
    expect(row.state).toBe("done");
    expect(row.total).toBe(expected.length);
    expect(row.published).toBe(expected.length);
    expect(row.failed).toBe(0);

    const consumer = new KafkaJS.Kafka({ kafkaJS: { brokers } }).consumer({
      kafkaJS: { groupId: "replay-check", fromBeginning: true },
    });
    await consumer.connect();
    await consumer.subscribe({ topics: [topic] });
    const received: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => {
      void consumer.run({
        eachMessage: async ({ message }) => {
          received.push(JSON.parse(message.value!.toString()));
          if (received.length === expected.length) resolve();
        },
      });
    });
    await consumer.disconnect();

    expect(received.map((m) => m.delivery_id)).toEqual(expected.map((e) => e.delivery_id));
    for (const message of received) {
      expect(typeof message.delivered_at).toBe("string");
      expect(message.sent_at).toBeNull();
    }
    // Some deliveries really did arrive late: delivered_at is after the event time.
    expect(
      received.some((m) => Date.parse(String(m.delivered_at)) > Date.parse(String(m.ts))),
    ).toBe(true);
  }, 120_000);

  it("a webhook that returns 500 yields dropped-0.parquet with a row per event, and the delivery fails", async () => {
    const expected = await deliveredRows("hook");
    expect(expected.length).toBeGreaterThan(0);
    // Stays under the breaker's 100-completion floor, so every event is retried and then dropped.
    expect(expected.length).toBeLessThan(100);

    const deliveries = fakeDeliveries();
    await runDelivery(
      {
        connection: {} as never,
        deliveries,
        createSink: () =>
          webhookSinkFactory.create(
            "hook",
            { url: webhookUrl, timeout_ms: 2000, max_attempts: 1 },
            null,
          ),
        backoff: { baseMs: 2, maxMs: 10 },
      },
      {
        runId,
        sinkName: "hook",
        destination: { sink: "hook", connectionId: "c2" },
        dataDir,
        engineVersion: ENGINE_VERSION,
      },
    );

    const row = (await deliveries.get(runId, "hook"))!;
    expect(row.state).toBe("failed");
    expect(row.total).toBe(expected.length);
    expect(row.published).toBe(0);
    expect(row.failed).toBe(expected.length);
    expect(row.last_error).toMatch(/dropped/);

    const droppedDir = path.join(dataDir, "runs", runId, "deliveries", "hook");
    expect(await readdir(droppedDir)).toEqual(["dropped-0.parquet"]);
    const dropped: Record<string, unknown>[] = [];
    for await (const label of readParquet(path.join(droppedDir, "dropped-0.parquet"))) {
      dropped.push(label);
    }
    expect(dropped).toHaveLength(expected.length);
    for (const label of dropped) {
      expect(label.delivery_outcome).toBe("dropped");
      expect(label.corruption_type ?? null).toBeNull();
      expect(JSON.parse(String(label.corruption_detail))).toMatchObject({
        error: "HTTP 500",
        attempts: 1,
      });
    }
    expect(new Set(dropped.map((l) => l.event_id))).toEqual(
      new Set(expected.map((e) => e.event_id)),
    );
  }, 120_000);

  it("a retry resumes from the saved cursor instead of starting over", async () => {
    const expected = await deliveredRows("hook");
    const half = Math.floor(expected.length / 2);
    const deliveries = fakeDeliveries();
    await deliveries.markRunning(runId, "hook", expected.length);
    await deliveries.recordProgress(runId, "hook", {
      cursor: { file_index: 0, row: half },
      published: half,
      failed: 0,
    });

    const seen: string[] = [];
    await runDelivery(
      {
        connection: {} as never,
        deliveries,
        createSink: () => ({
          type: "webhook",
          name: "hook",
          maxInFlight: 4,
          publish: async (_target, _body, envelope) => {
            seen.push(envelope.delivery_id);
            return { ok: true };
          },
          probe: async () => ({ ok: true, stage: "done", detail: "", latency_ms: 0 }),
          close: async () => {},
        }),
      },
      {
        runId,
        sinkName: "hook",
        destination: { sink: "hook", connectionId: "c3" },
        dataDir,
        engineVersion: ENGINE_VERSION,
      },
    );

    expect(seen.sort()).toEqual(
      expected
        .slice(half)
        .map((e) => String(e.delivery_id))
        .sort(),
    );
    const row = (await deliveries.get(runId, "hook"))!;
    expect(row.state).toBe("done");
    expect(row.published).toBe(expected.length);
  });
});
