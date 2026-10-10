import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import amqp, { type ChannelModel } from "amqplib";
import { RabbitMqSink } from "../../src/rabbitmq/publisher.js";

const envelope = (i: number) => ({ delivery_id: `d${i}`, event_id: `e${i}` });

// Testcontainers RabbitMQ — a full write buffer is reported as `saturated`. Run via
// `pnpm test:integration`.
describe("RabbitMQ sink: write-buffer-full surfaces as saturated", () => {
  let container: StartedTestContainer;
  let url: string;
  let host: string;
  let port: number;

  beforeAll(async () => {
    container = await new GenericContainer("rabbitmq:4-management-alpine")
      .withExposedPorts(5672)
      .start();
    host = container.getHost();
    port = container.getMappedPort(5672);
    url = `amqp://guest:guest@${host}:${port}`;
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it("sets saturated once the channel's write buffer signals full, and clears it on drain", async () => {
    const sink = new RabbitMqSink(
      "primary",
      {
        host,
        port,
        vhost: "/",
        tls: false,
        exchange: "txloom.stream",
        exchange_type: "topic",
        default_routing_key: "events",
      },
      { username: "guest", password: "guest" },
    );

    const setup: ChannelModel = await amqp.connect(url);
    const channel = await setup.createChannel();
    await channel.assertExchange("txloom.stream", "topic", { durable: true });
    await channel.assertQueue("txloom.stream.sink", { durable: true });
    await channel.bindQueue("txloom.stream.sink", "txloom.stream", "events");

    const large = new TextEncoder().encode(JSON.stringify({ blob: "x".repeat(64 * 1024) }));
    const signal = new AbortController().signal;
    const pending: Promise<unknown>[] = [];
    let sawSaturation = false;
    for (let i = 0; i < 5000 && !sawSaturation; i++) {
      pending.push(sink.publish({ routing_key: "events" }, large, envelope(i), signal));
      // Publishes are not awaited one by one: the write buffer fills only while confirms lag.
      await new Promise((resolve) => setImmediate(resolve));
      if (sink.saturated) sawSaturation = true;
    }
    expect(sawSaturation).toBe(true);

    await sink.waitForCapacity?.();
    expect(sink.saturated).toBe(false);
    const results = (await Promise.all(pending)) as { ok: boolean }[];
    expect(results.every((r) => r.ok)).toBe(true);

    await sink.close();
    await channel.close();
    await setup.close();
  }, 90_000);
});
