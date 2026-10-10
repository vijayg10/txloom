import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import { KafkaSink } from "../../src/kafka/producer.js";

describe("Kafka sink: acknowledgement", () => {
  let kafka: StartedTestContainer;
  let brokers: string[];

  beforeAll(async () => {
    // The advertised listener must name the host port, which Testcontainers would only assign
    // after the container starts, so reserve a free port first and bind to it.
    const port = await new Promise<number>((resolve, reject) => {
      const srv = createServer();
      srv.on("error", reject);
      srv.listen(0, () => {
        const { port: free } = srv.address() as { port: number };
        srv.close(() => resolve(free));
      });
    });
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
  }, 180_000);

  afterAll(async () => {
    await kafka?.stop();
  });

  it("publish resolves after the delivery report; 1,000 concurrent publishes all land", async () => {
    const topic = "ack.test";
    const admin = new KafkaJS.Kafka({ kafkaJS: { brokers } }).admin();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic, numPartitions: 3 }] });
    await admin.disconnect();

    const sink = new KafkaSink("primary", {
      bootstrap_servers: brokers,
      security_protocol: "PLAINTEXT",
      default_topic: topic,
    });
    sink.setRunContext({ runId: "run-1", sessionSeq: 2, engineVersion: 4 });
    expect(sink.maxInFlight).toBe(1000);

    const signal = new AbortController().signal;
    const total = 1000;
    const results = await Promise.all(
      Array.from({ length: total }, (_, i) =>
        sink.publish(
          { topic, key: `k${i % 17}` },
          new TextEncoder().encode(JSON.stringify({ event_id: `e${i}` })),
          { delivery_id: `d${i}`, event_id: `e${i}` },
          signal,
        ),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    await sink.close();

    // Every acknowledged message is really on the topic, with the run headers.
    const consumer = new KafkaJS.Kafka({ kafkaJS: { brokers } }).consumer({
      kafkaJS: { groupId: "ack-check", fromBeginning: true },
    });
    await consumer.connect();
    await consumer.subscribe({ topics: [topic] });
    const seen = new Set<string>();
    let headerOk = false;
    await new Promise<void>((resolve) => {
      void consumer.run({
        eachMessage: async ({ message }) => {
          seen.add(JSON.parse(message.value!.toString()).event_id);
          const headers = message.headers ?? {};
          if (headers["txloom-run-id"]?.toString() === "run-1") headerOk = true;
          if (seen.size === total) resolve();
        },
      });
    });
    await consumer.disconnect();
    expect(seen.size).toBe(total);
    expect(headerOk).toBe(true);
  }, 120_000);
});
