import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface ReceivedWebhookCall {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  receivedAt: number;
}

/** In-suite HTTP receiver (research.md R4) — the sink connection is configured
 * with `http://host.docker.internal:<port>/hook`, and every request the
 * product's webhook sink sends is recorded here for direct, synchronous
 * assertion (no mock-server container needed). */
export class WebhookListener {
  private readonly server: Server;
  private readonly calls: ReceivedWebhookCall[] = [];
  private port = 0;

  constructor() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        this.calls.push({
          method: req.method ?? "UNKNOWN",
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf-8"),
          receivedAt: Date.now(),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, "0.0.0.0", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  get url(): string {
    return `http://host.docker.internal:${this.port}/hook`;
  }

  get received(): readonly ReceivedWebhookCall[] {
    return this.calls;
  }

  clear(): void {
    this.calls.length = 0;
  }
}
