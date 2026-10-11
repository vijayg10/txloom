import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebhookSink } from "../../src/webhook/publisher.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function startServer(handler: Handler): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind test server");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

const envelope = { delivery_id: "d1", event_id: "e1" };
const body = new TextEncoder().encode('{"foo":"bar"}');

// Sink v2: `publish` makes exactly one attempt and reports how it went; retrying is the
// DeliveryPump's job (contracts/sink-plugin.md).
describe("webhook sink (Sink v2)", () => {
  let server: Server | undefined;

  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  async function sinkFor(handler: Handler, timeout_ms = 2000) {
    const started = await startServer(handler);
    server = started.server;
    return new WebhookSink("primary", { url: started.url, timeout_ms, max_attempts: 5 }, null);
  }

  it("never retries internally, even on a 500", async () => {
    let calls = 0;
    const sink = await sinkFor((_req, res) => {
      calls++;
      res.statusCode = 500;
      res.end();
    });
    const result = await sink.publish({}, body, envelope, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(calls).toBe(1);
  });

  it("resolves ok on a 2xx and sends the encoded body", async () => {
    let received = "";
    const sink = await sinkFor((req, res) => {
      req.on("data", (chunk) => (received += chunk));
      req.on("end", () => res.end());
    });
    expect(await sink.publish({}, body, envelope, new AbortController().signal)).toEqual({
      ok: true,
    });
    expect(received).toBe('{"foo":"bar"}');
  });

  it("resolves { ok:false, retryable:true } after timeout_ms when the server hangs", async () => {
    const sink = await sinkFor(() => {}, 150);
    const started = Date.now();
    const result = await sink.publish({}, body, envelope, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("treats a 400 as not retryable", async () => {
    const sink = await sinkFor((_req, res) => {
      res.statusCode = 400;
      res.end();
    });
    expect(await sink.publish({}, body, envelope, new AbortController().signal)).toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it.each([408, 429, 503])("treats a %i as retryable", async (status) => {
    const sink = await sinkFor((_req, res) => {
      res.statusCode = status;
      res.end();
    });
    expect(await sink.publish({}, body, envelope, new AbortController().signal)).toMatchObject({
      ok: false,
      retryable: true,
    });
  });

  it("honours the abort signal", async () => {
    const sink = await sinkFor(() => {}, 5000);
    const controller = new AbortController();
    const pending = sink.publish({}, body, envelope, controller.signal);
    setTimeout(() => controller.abort(), 50);
    expect(await pending).toMatchObject({ ok: false, retryable: true });
  });
});
