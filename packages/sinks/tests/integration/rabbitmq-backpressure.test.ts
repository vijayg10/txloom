import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import amqp, { type ChannelModel } from "amqplib";
import { RabbitMqSink } from "../../src/rabbitmq/publisher.js";

const envelope = (i: number) => ({
  delivery_id: `d${i}`,
  event_id: `e${i}`,
  ts: "2026-01-01T00:00:00.000Z",
});

// Testcontainers RabbitMQ — publisher confirms drive backpressure. Run via
// `pnpm test:integration`.
describe("RabbitMQ sink: publisher confirms drive backpressure", () => {
  let container: StartedTestContainer;
  let url: string;

  beforeAll(async () => {
    container = await new GenericContainer("rabbitmq:4-management-alpine")
      .withExposedPorts(5672)
      .start();
    url = `amqp://guest:guest@${container.getHost()}:${container.getMappedPort(5672)}`;
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it("reports backpressure once the channel's internal write buffer signals full", async () => {
    const sink = new RabbitMqSink("primary", {
      url,
      exchange: "txloom.stream",
      routingKey: "events",
    });

    // A queue with no consumer draining it, bound to the exchange, lets
    // messages pile up so the confirm-channel's socket write buffer (and
    // amqplib's internal backlog) eventually reports `false` from publish().
    const setup: ChannelModel = await amqp.connect(url);
    const channel = await setup.createChannel();
    await channel.assertExchange("txloom.stream", "topic", { durable: true });
    await channel.assertQueue("txloom.stream.sink", { durable: true });
    await channel.bindQueue("txloom.stream.sink", "txloom.stream", "events");

    let sawBackpressure = false;
    const largePayload = { blob: "x".repeat(64 * 1024) };
    for (let i = 0; i < 5000 && !sawBackpressure; i++) {
      const result = await sink.publish(largePayload, envelope(i));
      expect(result.ok).toBe(true);
      if (result.backpressure) sawBackpressure = true;
    }

    expect(sawBackpressure).toBe(true);

    await sink.close();
    await channel.close();
    await setup.close();
  }, 60_000);
});
