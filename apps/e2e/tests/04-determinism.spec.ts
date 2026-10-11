import { expect, test } from "@playwright/test";
import { TxLoomMcpClient } from "../src/mcp-client.js";
import { readDeliveredEvents, readTruthEvents } from "../src/data-dir.js";
import { createWebhookConnection } from "../src/api.js";
import { WebhookListener } from "../src/webhook-listener.js";
import fixture from "../fixtures/tiny-scenario.json" with { type: "json" };

// US4 (P4): same seed + spec = byte-identical truth output and delivered
// payloads through the full deployed stack (FR-007, constitution Principle
// II). Driven via MCP for precise, explicit seed control on both runs — the
// guarantee under test is the engine/delivery pipeline's, not either client's
// UI, and US1 already covers the UI journey itself.
const FILE_SINK_NAME = fixture.output.sinks[0]!.name;
// The webhook sink publishes up to its in-flight window (32) at once, so requests do not arrive in
// generation order. Each stream is therefore sampled well past that window, and the *earliest*
// events of one stream must all appear in the other's sample.
const WEBHOOK_SAMPLES = 100;
const EARLIEST_EVENTS = 8;
// Above 2^53: only survives as a string, and its high bits must still matter (R2).
const BIG_SEED = "18446744073709551557";

// The live phase needs a destination: the fixture plus one webhook sink, bound at launch.
const LIVE_SINK = "live-webhook";
const specWithWebhook = {
  ...fixture,
  output: {
    ...fixture.output,
    sinks: [...fixture.output.sinks, { type: "webhook", name: LIVE_SINK }],
  },
};

async function runFixtureOnce(
  mcp: TxLoomMcpClient,
  label: string,
  connectionId: string,
): Promise<string> {
  const scenario = await mcp.createScenario({
    name: `e2e-us4-${label}-${Date.now()}`,
    currency: fixture.currency,
  });
  await mcp.saveSpecVersion(scenario.id, specWithWebhook);
  const run = await mcp.launchRun(scenario.id, {
    seed: BIG_SEED,
    destinations: [{ sink: LIVE_SINK, connection_id: connectionId }],
  });
  await expect
    .poll(async () => (await mcp.getRunStatus(run.id)).status, { timeout: 60_000 })
    .toBe("completed");
  const finished = await mcp.getRunStatus(run.id);
  expect(finished.seed).toBe(BIG_SEED);
  expect(finished.engine_version).toBeGreaterThanOrEqual(2);
  return run.id;
}

function sortByEventId(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => String(a.event_id).localeCompare(String(b.event_id)));
}

test("determinism holds under full-stack execution @us4", async () => {
  test.setTimeout(180_000);
  const mcp = new TxLoomMcpClient();
  await mcp.connect();
  let runA = "";
  let runB = "";
  // One listener per run, so the first stream's trailing deliveries can't leak into the second.
  const listenerA = new WebhookListener();
  const listenerB = new WebhookListener();

  try {
    await listenerA.start();
    await listenerB.start();

    await test.step("run the fixed seed+spec twice end to end", async () => {
      const stamp = Date.now();
      const connectionA = await createWebhookConnection(`e2e-us4-a-${stamp}`, listenerA.url);
      const connectionB = await createWebhookConnection(`e2e-us4-b-${stamp}`, listenerB.url);
      runA = await runFixtureOnce(mcp, "a", connectionA);
      runB = await runFixtureOnce(mcp, "b", connectionB);
    });

    await test.step("truth records are byte-identical between the two runs", async () => {
      const [truthA, truthB] = await Promise.all([readTruthEvents(runA), readTruthEvents(runB)]);
      expect(truthA.length).toBeGreaterThan(0);
      expect(truthA.length).toBe(truthB.length);
      expect(sortByEventId(truthA)).toEqual(sortByEventId(truthB));
    });

    await test.step("file-sink delivered output is byte-identical between the two runs", async () => {
      const [deliveredA, deliveredB] = await Promise.all([
        readDeliveredEvents(runA, FILE_SINK_NAME),
        readDeliveredEvents(runB, FILE_SINK_NAME),
      ]);
      expect(deliveredA.length).toBeGreaterThan(0);
      expect(deliveredA.length).toBe(deliveredB.length);
      expect(sortByEventId(deliveredA)).toEqual(sortByEventId(deliveredB));
    });

    await test.step("webhook-delivered payloads are identical once run-identifying timestamps are stripped", async () => {
      // Sequential, not concurrent: the worker processes one stream-drive job
      // at a time and a stream runs until explicitly stopped, so two streams
      // started together deadlock (the second queues behind the first).
      async function collectWebhookSamples(
        runId: string,
        listener: WebhookListener,
      ): Promise<Record<string, unknown>[]> {
        await mcp.startStream(runId);
        await expect
          .poll(() => listener.received.length, { timeout: 30_000 })
          .toBeGreaterThanOrEqual(WEBHOOK_SAMPLES);
        await mcp.stopStream(runId);
        return listener.received
          .slice(0, WEBHOOK_SAMPLES)
          .map((call) => JSON.parse(call.body) as Record<string, unknown>);
      }

      // Live-streamed events intentionally stamp event_id/ts from the real
      // clock at delivery time (packages/engine/src/streaming/live-world.ts
      // `drawNextLiveEvent` takes `nowMs`) — a live TPS-paced stream's
      // timestamp is supposed to reflect real delivery time, not a virtual
      // one. spec.md's own acceptance scenario anticipates exactly this:
      // "excluding run-identifying metadata such as timestamps of when the
      // test itself executed." Every other field (amount, consumer, merchant,
      // status, type, currency) is content the engine must still reproduce
      // identically for the same seed+spec.
      function withoutRunIdentifyingFields(row: Record<string, unknown>): string {
        const {
          event_id: _eventId,
          delivery_id: _deliveryId,
          ts: _ts,
          delivered_at: _deliveredAt,
          sent_at: _sentAt,
          ...rest
        } = row;
        return JSON.stringify(rest);
      }

      /** The earliest events generated, by event_id (a ULID, so time-ordered). */
      function earliest(rows: Record<string, unknown>[]): string[] {
        return [...rows]
          .sort((a, b) => String(a.event_id).localeCompare(String(b.event_id)))
          .slice(0, EARLIEST_EVENTS)
          .map(withoutRunIdentifyingFields);
      }

      const bodiesA = await collectWebhookSamples(runA, listenerA);
      const bodiesB = await collectWebhookSamples(runB, listenerB);
      const contentA = bodiesA.map(withoutRunIdentifyingFields);
      const contentB = bodiesB.map(withoutRunIdentifyingFields);
      // The same seed continues the same world, so event k has the same content in both runs.
      for (const content of earliest(bodiesA)) expect(contentB).toContain(content);
      for (const content of earliest(bodiesB)) expect(contentA).toContain(content);
    });
  } finally {
    await listenerA.stop();
    await listenerB.stop();
    await mcp.close();
  }
});
