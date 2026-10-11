import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import { AimdPacer, DeliveryPump } from "../../src/pump.js";
import { KafkaSink } from "../../src/kafka/producer.js";

const TARGET_TPS = 2000;
const QUOTA_BYTES_PER_SECOND = 20_000;

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

// A broker that throttles the producer's client id (`producer_byte_rate`) must show up as
// backpressure, a lower paced rate, and bounded memory (US7). Run via `pnpm test:integration`.
describe("Kafka sink under a producer quota", () => {
  let kafka: StartedTestContainer;
  let brokers: string[];

  beforeAll(async () => {
    const port = await freePort();
    kafka = await new GenericContainer("apache/kafka:3.9.0")
      .withExposedPorts({ container: 9092, host: port })
      .withEnvironment({
        KAFKA_NODE_ID: "1",
        KAFKA_PROCESS_ROLES: "broker,controller",
        KAFKA_LISTENERS: "PLAINTEXT://:9092,ADMIN://:9095,CONTROLLER://:9093",
        // ADMIN is reachable from inside the container, for the quota command below.
        KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://localhost:${port},ADMIN://localhost:9095`,
        KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
        KAFKA_CONTROLLER_QUORUM_VOTERS: "1@localhost:9093",
        KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
          "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,ADMIN:PLAINTEXT",
        KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: "1",
        KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1",
        KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: "1",
      })
      .start();
    brokers = [`localhost:${port}`];
    // The sink's librdkafka client id is "txloom".
    const result = await kafka.exec([
      "/opt/kafka/bin/kafka-configs.sh",
      "--bootstrap-server",
      "localhost:9095",
      "--alter",
      "--add-config",
      `producer_byte_rate=${QUOTA_BYTES_PER_SECOND}`,
      "--entity-type",
      "clients",
      "--entity-name",
      "txloom",
    ]);
    if (result.exitCode !== 0) throw new Error(`setting the quota failed: ${result.output}`);
    const admin = new KafkaJS.Kafka({ kafkaJS: { brokers } }).admin();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic: "throttled", numPartitions: 1 }] });
    await admin.disconnect();
  }, 180_000);

  afterAll(async () => {
    await kafka?.stop();
  });

  it("sets backpressure, lowers aimd_rate below the target, and keeps memory bounded", async () => {
    const sink = new KafkaSink("events", {
      bootstrap_servers: brokers,
      security_protocol: "PLAINTEXT",
      default_topic: "throttled",
    });
    const pacer = new AimdPacer({ targetTps: TARGET_TPS });
    const pump = new DeliveryPump({ sink, pacing: pacer, onDropped: () => {} });
    const body = new TextEncoder().encode(JSON.stringify({ blob: "x".repeat(400) }));

    const rssBefore = process.memoryUsage().rss;
    let sawBackpressure = false;
    let lowestRate = TARGET_TPS;
    let peakLag = 0;
    const sampler = setInterval(() => {
      const metrics = pump.metrics();
      sawBackpressure ||= metrics.backpressure;
      lowestRate = Math.min(lowestRate, metrics.aimd_rate ?? TARGET_TPS);
      peakLag = Math.max(peakLag, metrics.sink_lag);
    }, 500);

    const startedAt = Date.now();
    let n = 0;
    while (Date.now() - startedAt < 20_000) {
      n++;
      await pump.submit({
        body,
        envelope: { delivery_id: `d${n}`, event_id: `e${n}` },
        target: { key: `k${n}` },
      });
    }
    clearInterval(sampler);
    const rssAfter = process.memoryUsage().rss;
    const achievedPerSecond = pump.metrics().delivered_total / 20;
    pump.stop();
    await sink.close();

    expect(sawBackpressure).toBe(true);
    expect(lowestRate).toBeLessThan(TARGET_TPS);
    // The quota allows ~50 messages a second; the pump is paced far below the target, not buffering.
    expect(achievedPerSecond).toBeLessThan(TARGET_TPS / 2);
    // Everything submitted is either in flight (bounded by the window) or already delivered.
    expect(peakLag).toBeLessThanOrEqual(sink.maxInFlight + 1);
    expect(rssAfter - rssBefore).toBeLessThan(150 * 1024 * 1024);
  }, 120_000);
});
