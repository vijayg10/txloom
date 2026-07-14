import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Queue, type ConnectionOptions } from "bullmq";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { SimulationSpec } from "@txloom/spec";
import { generateMerchantPool } from "@txloom/engine";
import {
  startStreamDriveWorker,
  type StreamControlSnapshot,
  type StreamDriveJobData,
  type StreamMetrics,
} from "../../src/jobs/stream-drive.js";

const spec: SimulationSpec = {
  seed: 11,
  currency: "INR",
  locale: "en-IN",
  channel: "upi",
  clock: { start: "2026-01-01", days: 3, then_stream_tps: 40 },
  population: {
    consumers: {
      count: 20,
      archetypes: [
        {
          name: "salaried",
          weight: 1,
          income_pattern: {
            kind: "fixed_credit_day",
            day_of_month: 1,
            amount_mean: 50000,
            amount_stddev: 5000,
          },
          spend_rhythm: {
            daily_transaction_count_mean: 2,
            daily_transaction_count_stddev: 1,
            weekend_multiplier: 1.2,
          },
        },
      ],
    },
    merchants: {
      count: 5,
      categories: {
        grocery: {
          name: "grocery",
          weight: 1,
          amount_distribution: { kind: "lognormal", mean: 500, stddev: 100 },
        },
      },
    },
  },
  seasonality: [],
  fraud: { target_rate: 0.01, typologies: [] },
  outcomes: { baseline_decline_rate: 0.02 },
  imperfections: {},
  output: { sinks: [{ type: "kafka", name: "primary" }], labels: "separate_export" },
};

// Testcontainers Kafka — sustained delivery converges on target TPS within
// tolerance (SC-007). Run via `pnpm test:integration`.
describe("stream-drive job: sustained Kafka delivery", () => {
  let kafka: StartedTestContainer;
  let brokers: string[];
  let connection: ConnectionOptions;
  let redis: StartedTestContainer;

  beforeAll(async () => {
    kafka = await new GenericContainer("apache/kafka:3.9.0")
      .withExposedPorts(9092)
      .withEnvironment({
        KAFKA_NODE_ID: "1",
        KAFKA_PROCESS_ROLES: "broker,controller",
        KAFKA_LISTENERS: "PLAINTEXT://:9092,CONTROLLER://:9093",
        KAFKA_ADVERTISED_LISTENERS: "PLAINTEXT://localhost:9092",
        KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
        KAFKA_CONTROLLER_QUORUM_VOTERS: "1@localhost:9093",
        KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
      })
      .start();
    brokers = [`${kafka.getHost()}:${kafka.getMappedPort(9092)}`];

    const redisContainer = new GenericContainer("redis:7-alpine").withExposedPorts(6379);
    redis = await redisContainer.start();
    connection = {
      host: redis.getHost(),
      port: redis.getMappedPort(6379),
      maxRetriesPerRequest: null,
    };
  }, 180_000);

  afterAll(async () => {
    await redis?.stop();
    await kafka?.stop();
  });

  it("achieves a delivered throughput within tolerance of the configured target TPS", async () => {
    const targetTps = 40;
    const topic = "txloom.stream.test";
    const queue = new Queue<StreamDriveJobData>("stream-drive", { connection });

    let state: StreamControlSnapshot["state"] = "streaming";
    const metricsSamples: StreamMetrics[] = [];

    const worker = startStreamDriveWorker({
      connection,
      getStreamControl: async () => ({ state, targetTps }),
      onMetrics: async (_streamId, metrics) => {
        metricsSamples.push(metrics);
      },
      tickMs: 100,
    });

    const seed = BigInt(spec.seed);
    const merchants = generateMerchantPool(spec, seed);
    await queue.add("stream", {
      runId: "stream-test-run",
      streamId: "stream-test-1",
      spec,
      seed: seed.toString(),
      partitionCount: 1,
      merchants,
      sink: { type: "kafka", config: { brokers, topic } },
      labelChannelEnabled: false,
    });

    const consumerKafka = new KafkaJS.Kafka({ kafkaJS: { brokers } });
    const consumer = consumerKafka.consumer({ kafkaJS: { groupId: "test-group" } });
    await consumer.connect();
    await consumer.subscribe({ topics: [topic] });

    let received = 0;
    await consumer.run({
      eachMessage: async () => {
        received++;
      },
    });

    // Let the stream run for a sustained window, then stop it.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    state = "stopped";
    await worker.close();
    await consumer.disconnect();
    await queue.close();

    const achievedTps = received / 5;
    expect(achievedTps).toBeGreaterThan(targetTps * 0.5);
    expect(achievedTps).toBeLessThan(targetTps * 1.5);
    expect(metricsSamples.length).toBeGreaterThan(0);
  }, 60_000);
});
