import { expect, test } from "@playwright/test";
import { TxLoomUi } from "../src/ui.js";
import {
  readCorruptions,
  readDeliveredEvents,
  readDropped,
  readTruthEvents,
} from "../src/data-dir.js";
import { KafkaTestConsumer } from "../src/kafka-consumer.js";
import fixture from "../fixtures/imperfections-all.json" with { type: "json" };

// US2 (P1): the answer key is honest for every sink. For the file sink (read from ./data) and
// the Kafka topic (read as an external consumer would), the delivered records and the answer key
// reconcile: no record without a truth event (orphan), no truth event missing from both the
// delivery and the dropped labels, and every corruption label points at a record the sink
// really received (SC-004).
const FILE_SINK = "archive";
const KAFKA_SINK = "events";

type Row = Record<string, unknown>;

interface Reconciliation {
  orphans: string[];
  missing: string[];
  labelsWithoutRecord: string[];
}

function reconcile(
  truth: readonly Row[],
  received: readonly Row[],
  corruptions: readonly Row[],
  dropped: readonly Row[],
): Reconciliation {
  const truthIds = new Set(truth.map((e) => String(e.event_id)));
  const receivedIds = new Set(received.map((e) => String(e.event_id)));
  const droppedIds = new Set(dropped.map((e) => String(e.event_id)));
  return {
    orphans: [...receivedIds].filter((id) => !truthIds.has(id)),
    missing: [...truthIds].filter((id) => !receivedIds.has(id) && !droppedIds.has(id)),
    labelsWithoutRecord: corruptions
      .map((c) => String(c.event_id))
      .filter((id) => !receivedIds.has(id)),
  };
}

test("delivered output reconciles with the answer key for the file sink and Kafka @answer-key", async ({
  page,
}) => {
  const ui = new TxLoomUi(page);
  const stamp = Date.now();
  const topic = `txloom.e2e.answer-key.${stamp}`;
  const connection = `e2e-answer-key-${stamp}`;
  await ui.createConnection({ type: "kafka", name: connection, bootstrap: "kafka:29092", topic });

  const consumer = new KafkaTestConsumer();
  await consumer.start(topic);
  try {
    const { runId } = await ui.authorValidateSaveLaunch(fixture, {
      scenarioName: `e2e-answer-key-${stamp}`,
      currency: fixture.currency,
      destinations: [{ sink: KAFKA_SINK, connection }],
      replayHistory: true,
    });

    const truth = await readTruthEvents(runId);
    expect(truth.length).toBeGreaterThan(0);

    await test.step("the history replay to Kafka finishes", async () => {
      await expect
        .poll(
          async () => {
            const response = await page.request.get(`/api/v1/runs/${runId}`);
            const run = (await response.json()) as {
              deliveries: { sink: string; state: string }[];
            };
            return run.deliveries.find((d) => d.sink === KAFKA_SINK)?.state;
          },
          { timeout: 120_000 },
        )
        .toBe("done");
    });

    await test.step("file sink: no orphans, nothing missing, every label has a record", async () => {
      const [delivered, corruptions, dropped] = await Promise.all([
        readDeliveredEvents(runId, FILE_SINK),
        readCorruptions(runId, FILE_SINK),
        readDropped(runId, FILE_SINK),
      ]);
      expect(corruptions.length).toBeGreaterThan(0);
      const result = reconcile(truth, delivered, corruptions, dropped);
      expect(result.orphans).toEqual([]);
      expect(result.missing).toEqual([]);
      expect(result.labelsWithoutRecord).toEqual([]);
      // Duplicates are exactly the extra physical copies.
      const duplicates = corruptions.filter((c) => c.corruption_type === "duplicate").length;
      expect(delivered.length).toBe(truth.length + duplicates);
    });

    await test.step("Kafka: the topic holds exactly the delivered/events rows, and they reconcile", async () => {
      const [delivered, corruptions, dropped] = await Promise.all([
        readDeliveredEvents(runId, KAFKA_SINK),
        readCorruptions(runId, KAFKA_SINK),
        readDropped(runId, KAFKA_SINK),
      ]);
      expect(dropped).toEqual([]);
      await expect.poll(() => consumer.received.length, { timeout: 60_000 }).toBe(delivered.length);

      const onTopic = consumer.received.map((m) => m.value);
      expect(onTopic.map((m) => m.delivery_id)).toEqual(delivered.map((d) => d.delivery_id));
      for (const message of onTopic) {
        expect(typeof message.delivered_at).toBe("string");
        expect(message).not.toHaveProperty("is_fraud");
      }

      const result = reconcile(truth, onTopic, corruptions, dropped);
      expect(result.orphans).toEqual([]);
      expect(result.missing).toEqual([]);
      expect(result.labelsWithoutRecord).toEqual([]);
    });
  } finally {
    await consumer.stop();
  }
});
