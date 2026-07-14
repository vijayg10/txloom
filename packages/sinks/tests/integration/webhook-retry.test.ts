import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebhookSink } from "../../src/webhook/publisher.js";

async function startServer(
  handler: (req: Parameters<Parameters<typeof createServer>[0]>[0]) => void,
): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    handler(req);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind test server");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

const envelope = { delivery_id: "d1", event_id: "e1", ts: "2026-01-01T00:00:00.000Z" };

describe("webhook sink retry with exponential backoff", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  it("retries with exponential backoff and jitter until success", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const started = await startServer((req) => {
      attempts++;
      req.destroy(); // first attempts fail with a connection reset
    });
    server = started.server;

    let callCount = 0;
    const sink = new WebhookSink(
      "primary",
      { url: started.url, maxAttempts: 5, baseDelayMs: 10 },
      {
        rand: () => 0.5,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    // Replace the destroy-connection behavior with success after 3 failures.
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      callCount++;
      if (callCount <= 3) {
        req.destroy();
        return;
      }
      res.end();
    });

    const result = await sink.publish({ foo: "bar" }, envelope);
    expect(result.ok).toBe(true);
    expect(callCount).toBe(4);
    expect(delays.length).toBe(3);
    // Exponential growth: each delay roughly doubles the last (allowing for jitter).
    expect(delays[1]!).toBeGreaterThan(delays[0]! * 1.2);
    expect(delays[2]!).toBeGreaterThan(delays[1]! * 1.2);
    void attempts;
  });

  it("gives up after maxAttempts and reports the last error", async () => {
    const started = await startServer(() => {});
    server = started.server;
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      res.statusCode = 500;
      res.end();
    });

    const sink = new WebhookSink(
      "primary",
      { url: started.url, maxAttempts: 3, baseDelayMs: 5 },
      { rand: () => 0, sleep: async () => {} },
    );

    const result = await sink.publish({ foo: "bar" }, envelope);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 500");
  });
});
