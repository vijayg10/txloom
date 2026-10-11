import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AimdPacer, DeliveryPump, type DroppedLabel } from "../../src/pump.js";
import { WebhookSink } from "../../src/webhook/publisher.js";

const TARGET_TPS = 200;
const SECONDS = 20;

// One endpoint that never answers some deliveries must not stall the rest (US7): hung requests
// time out, the window keeps turning over, and a delivery that exhausts its retries is dropped.
describe("webhook with hanging deliveries", () => {
  let server: Server;
  let url: string;
  let hungRequests = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const { n } = JSON.parse(raw) as { n: number };
        if (n % 20 === 0) {
          hungRequests++;
          return; // never answered: the client's timeout has to free the slot
        }
        res.statusCode = 200;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it(`never drops to 0 delivered per second over ${SECONDS} s at ${TARGET_TPS} TPS, and drops what exhausts its retries`, async () => {
    const sink = new WebhookSink("hook", { url, timeout_ms: 300, max_attempts: 2 }, null);
    const dropped: DroppedLabel[] = [];
    const pacer = new AimdPacer({ targetTps: TARGET_TPS });
    const pump = new DeliveryPump({
      sink,
      pacing: pacer,
      maxAttempts: 2,
      backoff: { baseMs: 50, maxMs: 200 },
      onDropped: (label) => {
        dropped.push(label);
      },
    });

    const perSecond: number[] = [];
    let lastDelivered = 0;
    const sampler = setInterval(() => {
      const { delivered_total } = pump.metrics();
      perSecond.push(delivered_total - lastDelivered);
      lastDelivered = delivered_total;
    }, 1000);

    const startedAt = Date.now();
    let n = 1;
    while (Date.now() - startedAt < SECONDS * 1000) {
      await pump.submit({
        body: new TextEncoder().encode(JSON.stringify({ n })),
        envelope: { delivery_id: `d${n}`, event_id: `e${n}` },
      });
      n++;
    }
    clearInterval(sampler);
    await pump.drain();
    pump.stop();

    expect(perSecond.length).toBeGreaterThanOrEqual(SECONDS - 1);
    for (const delivered of perSecond.slice(0, SECONDS - 1)) {
      expect(delivered).toBeGreaterThan(0);
    }
    // Roughly the target rate, even with 1 in 20 requests hanging.
    const total = perSecond.reduce((sum, v) => sum + v, 0);
    expect(total / perSecond.length).toBeGreaterThan(TARGET_TPS * 0.5);
    // The hanging deliveries exhausted both attempts and are on record as dropped.
    expect(hungRequests).toBeGreaterThan(0);
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every((label) => label.delivery_outcome === "dropped")).toBe(true);
    // Nothing that hung was counted as delivered.
    expect(pump.metrics().delivered_total + pump.metrics().failed_total).toBeLessThanOrEqual(n - 1);
  }, 60_000);
});
