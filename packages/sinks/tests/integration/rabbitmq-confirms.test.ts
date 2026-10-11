import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import amqp, { type ChannelModel } from "amqplib";
import { RabbitMqSink } from "../../src/rabbitmq/publisher.js";

const envelope = { delivery_id: "d1", event_id: "e1" };
const body = new TextEncoder().encode('{"a":1}');

describe("RabbitMQ sink: publisher confirms", () => {
  let container: StartedTestContainer;
  let host: string;
  let port: number;

  const sinkFor = (exchange: string, routingKey = "events") =>
    new RabbitMqSink(
      "primary",
      {
        host,
        port,
        vhost: "/",
        tls: false,
        exchange,
        exchange_type: "topic",
        default_routing_key: routingKey,
      },
      { username: "guest", password: "guest" },
    );

  beforeAll(async () => {
    container = await new GenericContainer("rabbitmq:4-management-alpine")
      .withExposedPorts(5672)
      .start();
    host = container.getHost();
    port = container.getMappedPort(5672);
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it("resolves ok only after the broker confirms, and the message is then on the queue", async () => {
    const setup: ChannelModel = await amqp.connect(`amqp://guest:guest@${host}:${port}`);
    const channel = await setup.createChannel();
    await channel.assertExchange("confirms.x", "topic", { durable: true });
    await channel.assertQueue("confirms.q", { durable: true });
    await channel.bindQueue("confirms.q", "confirms.x", "events");

    const sink = sinkFor("confirms.x");
    const result = await sink.publish({}, body, envelope, new AbortController().signal);
    expect(result).toEqual({ ok: true });

    // A confirmed message is already routed: it can be fetched right away.
    const message = await channel.get("confirms.q", { noAck: true });
    expect(message && message.content.toString()).toBe('{"a":1}');

    await sink.close();
    await channel.close();
    await setup.close();
  }, 60_000);

  it("holds the result back until confirms flow again when the connection is blocked", async () => {
    // Blocking the broker's connection (a memory alarm) stops confirms, so the promise must stay
    // pending rather than claim success.
    const sink = sinkFor("blocked.x");
    const setup: ChannelModel = await amqp.connect(`amqp://guest:guest@${host}:${port}`);
    const channel = await setup.createChannel();
    await channel.assertExchange("blocked.x", "topic", { durable: true });
    await channel.assertQueue("blocked.q", { durable: true });
    await channel.bindQueue("blocked.q", "blocked.x", "events");
    expect(await sink.publish({}, body, envelope, new AbortController().signal)).toEqual({
      ok: true,
    });

    await container.exec(["rabbitmqctl", "set_vm_memory_high_watermark", "0.0000001"]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    let settled = false;
    const pending = sink
      .publish({}, body, { delivery_id: "d2", event_id: "e2" }, new AbortController().signal)
      .then((r) => {
        settled = true;
        return r;
      });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(settled).toBe(false);

    await container.exec(["rabbitmqctl", "set_vm_memory_high_watermark", "0.6"]);
    expect(await pending).toEqual({ ok: true });

    await sink.close();
    await channel.close();
    await setup.close();
  }, 90_000);

  it("resolves ok:false, retryable when the publish cannot be confirmed", async () => {
    const setup: ChannelModel = await amqp.connect(`amqp://guest:guest@${host}:${port}`);
    const channel = await setup.createChannel();
    const sink = sinkFor("vanishing.x");
    expect(await sink.publish({}, body, envelope, new AbortController().signal)).toEqual({
      ok: true,
    });

    // Publishing to an exchange that no longer exists makes the broker close the channel
    // instead of confirming.
    await channel.deleteExchange("vanishing.x");
    const result = await sink.publish({}, body, envelope, new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);

    await sink.close();
    await channel.close();
    await setup.close();
  }, 60_000);
});
