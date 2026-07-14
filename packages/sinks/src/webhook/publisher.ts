import type {
  Sink,
  SinkDeliveryEnvelope,
  SinkFactory,
  SinkPublishResult,
  SinkTestResult,
} from "../interface.js";

export interface WebhookSinkConfig {
  url: string;
  headers?: Record<string, string>;
  /** Retry attempts before giving up (default 5, D15). */
  maxAttempts?: number;
  /** Base delay for exponential backoff, milliseconds (default 200). */
  baseDelayMs?: number;
}

function jitteredBackoffMs(attempt: number, baseDelayMs: number, rand: () => number): number {
  const exp = baseDelayMs * 2 ** (attempt - 1);
  return exp / 2 + rand() * (exp / 2);
}

/**
 * Plain HTTP POST webhook sink (D15 — no signing secret in v1). Retries
 * failed deliveries with exponential backoff + jitter, 5 attempts by
 * default; `rand`/`sleep` are injectable so retry-delay tests stay
 * deterministic and fast.
 */
export class WebhookSink implements Sink {
  readonly type = "webhook" as const;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly rand: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly name: string,
    private readonly config: WebhookSinkConfig,
    overrides: { rand?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.maxAttempts = config.maxAttempts ?? 5;
    this.baseDelayMs = config.baseDelayMs ?? 200;
    this.rand = overrides.rand ?? Math.random;
    this.sleep = overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async publish(
    payload: Record<string, unknown>,
    envelope: SinkDeliveryEnvelope,
  ): Promise<SinkPublishResult> {
    const body = JSON.stringify({ ...payload, delivery_id: envelope.delivery_id, ts: envelope.ts });
    let lastError = "unknown error";

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await fetch(this.config.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...this.config.headers },
          body,
        });
        if (response.ok) return { ok: true };
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = (error as Error).message;
      }
      if (attempt < this.maxAttempts) {
        await this.sleep(jitteredBackoffMs(attempt, this.baseDelayMs, this.rand));
      }
    }
    return { ok: false, error: lastError };
  }

  async testConnection(): Promise<SinkTestResult> {
    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return { ok: response.ok, detail: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }

  async close(): Promise<void> {
    // No persistent connection to release — each publish is a standalone HTTP request.
  }
}

export const webhookSinkFactory: SinkFactory<WebhookSinkConfig> = {
  type: "webhook",
  create(name, config) {
    return new WebhookSink(name, config);
  },
};
