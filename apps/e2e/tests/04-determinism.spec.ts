import { expect, test } from "@playwright/test";
import { TxLoomMcpClient } from "../src/mcp-client.js";
import { readDeliveredEvents, readTruthEvents } from "../src/data-dir.js";
import { WebhookListener } from "../src/webhook-listener.js";
import fixture from "../fixtures/tiny-scenario.json" with { type: "json" };

// US4 (P4): same seed + spec = byte-identical truth output and delivered
// payloads through the full deployed stack (FR-007, constitution Principle
// II). Driven via MCP for precise, explicit seed control on both runs — the
// guarantee under test is the engine/delivery pipeline's, not either client's
// UI, and US1 already covers the UI journey itself.
const FILE_SINK_NAME = fixture.output.sinks[0]!.name;
const MIN_WEBHOOK_SAMPLES = 5;

async function runFixtureOnce(mcp: TxLoomMcpClient, label: string): Promise<string> {
  const scenario = await mcp.createScenario({
    name: `e2e-us4-${label}-${Date.now()}`,
    currency: fixture.currency,
  });
  await mcp.saveSpecVersion(scenario.id, fixture);
  const run = await mcp.launchRun(scenario.id, { seed: fixture.seed });
  await expect
    .poll(async () => (await mcp.getRunStatus(run.id)).status, { timeout: 60_000 })
    .toBe("completed");
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

  try {
    await test.step("run the fixed seed+spec twice end to end", async () => {
      runA = await runFixtureOnce(mcp, "a");
      runB = await runFixtureOnce(mcp, "b");
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
      async function collectWebhookSamples(runId: string): Promise<Record<string, unknown>[]> {
        const listener = new WebhookListener();
        await listener.start();
        try {
          await mcp.startStream(runId, { type: "webhook", config: { url: listener.url } });
          await expect
            .poll(() => listener.received.length, { timeout: 20_000 })
            .toBeGreaterThanOrEqual(MIN_WEBHOOK_SAMPLES);
          await mcp.stopStream(runId);
          return listener.received
            .slice(0, MIN_WEBHOOK_SAMPLES)
            .map((call) => JSON.parse(call.body) as Record<string, unknown>);
        } finally {
          await listener.stop();
        }
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
      function withoutRunIdentifyingFields(row: Record<string, unknown>): Record<string, unknown> {
        const { event_id: _eventId, delivery_id: _deliveryId, ts: _ts, ...rest } = row;
        return rest;
      }

      const bodiesA = await collectWebhookSamples(runA);
      const bodiesB = await collectWebhookSamples(runB);
      expect(bodiesA.map(withoutRunIdentifyingFields)).toEqual(
        bodiesB.map(withoutRunIdentifyingFields),
      );
    });
  } finally {
    await mcp.close();
  }
});
