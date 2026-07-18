import { expect, test } from "@playwright/test";
import { TxLoomUi } from "../src/ui.js";
import { readDeliveredEvents, readTruthEvents } from "../src/data-dir.js";
import { KafkaTestConsumer } from "../src/kafka-consumer.js";
import { RabbitMqTestConsumer } from "../src/rabbitmq-consumer.js";
import { WebhookListener } from "../src/webhook-listener.js";
import fixture from "../fixtures/tiny-scenario.json" with { type: "json" };

// US2 (P2): verify delivery across all four sinks as an external consumer
// would observe them, and that labels stay out of the default export
// (FR-004/005). File-sink delivery is a batch-mode side effect of the
// fixture's declared output.sinks (research.md R10); Kafka/RabbitMQ/webhook
// delivery only happens over the network once a stream is started
// (stream-control.ts) — no live TPS-paced session ships without one.
const FILE_SINK_NAME = fixture.output.sinks[0]!.name;

test("file sink delivery and default label exclusion @us2", async ({ page }) => {
  const ui = new TxLoomUi(page);
  const { runId } = await ui.authorValidateSaveLaunch(fixture, {
    scenarioName: `e2e-us2-file-${Date.now()}`,
    currency: fixture.currency,
  });

  await test.step("expected output files exist under ./data with expected event counts", async () => {
    const [delivered, truth] = await Promise.all([
      readDeliveredEvents(runId, FILE_SINK_NAME),
      readTruthEvents(runId),
    ]);
    expect(truth.length).toBeGreaterThan(0);
    expect(delivered.length).toBeGreaterThan(0);
    // duplicate_delivery (rate 0.2) can inflate delivered count above truth count.
    expect(delivered.length).toBeGreaterThanOrEqual(truth.length);
    expect(delivered.length).toBeLessThanOrEqual(truth.length * 1.5);
  });

  await test.step("default export excludes fraud/imperfection labels", async () => {
    const { downloadHref } = await ui.triggerExport(runId, "json");
    const response = await page.request.get(downloadHref);
    expect(response.ok()).toBeTruthy();
    const rows = JSON.parse(await response.text()) as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("is_fraud");
      expect(row).not.toHaveProperty("typology");
    }
  });
});

test("Kafka sink delivery @us2", async ({ page }) => {
  const ui = new TxLoomUi(page);
  const { runId } = await ui.authorValidateSaveLaunch(fixture, {
    scenarioName: `e2e-us2-kafka-${Date.now()}`,
    currency: fixture.currency,
  });

  const topic = `txloom.e2e.${runId}`;
  const consumer = new KafkaTestConsumer();
  await consumer.start(topic);
  try {
    await ui.startStream(runId, { type: "kafka", brokers: "kafka:29092", topic }, 50);
    await expect.poll(() => consumer.received.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await ui.stopStream();
  } finally {
    await consumer.stop();
  }
  expect(consumer.received.length).toBeGreaterThan(0);
});

test("RabbitMQ sink delivery @us2", async ({ page }) => {
  const ui = new TxLoomUi(page);
  const { runId } = await ui.authorValidateSaveLaunch(fixture, {
    scenarioName: `e2e-us2-rabbitmq-${Date.now()}`,
    currency: fixture.currency,
  });

  const exchange = `txloom.e2e.${runId}`;
  const routingKey = "events";
  const consumer = new RabbitMqTestConsumer();
  await consumer.start(exchange, routingKey);
  try {
    await ui.startStream(
      runId,
      { type: "rabbitmq", url: "amqp://rabbitmq:5672", exchange, routingKey },
      50,
    );
    await expect.poll(() => consumer.received.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await ui.stopStream();
  } finally {
    await consumer.stop();
  }
  expect(consumer.received.length).toBeGreaterThan(0);
});

test("webhook sink delivery @us2", async ({ page }) => {
  const ui = new TxLoomUi(page);
  const { runId } = await ui.authorValidateSaveLaunch(fixture, {
    scenarioName: `e2e-us2-webhook-${Date.now()}`,
    currency: fixture.currency,
  });

  const listener = new WebhookListener();
  await listener.start();
  try {
    await ui.startStream(runId, { type: "webhook", url: listener.url }, 50);
    await expect.poll(() => listener.received.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await ui.stopStream();
  } finally {
    await listener.stop();
  }
  expect(listener.received.length).toBeGreaterThan(0);
  expect(listener.received[0]!.method).toBe("POST");
});
