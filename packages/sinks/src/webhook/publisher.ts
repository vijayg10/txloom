import type {
  ProbeResult,
  Sink,
  SinkDeliveryEnvelope,
  SinkFactory,
  SinkPublishResult,
} from "../interface.js";
import {
  webhookConfigSchema,
  webhookSecretsSchema,
  type WebhookConnectionConfig,
  type WebhookConnectionSecrets,
} from "./config.js";

export type { WebhookConnectionConfig as WebhookSinkConfig };

function jitteredBackoffMs(attempt: number, baseDelayMs: number, rand: () => number): number {
  const exp = baseDelayMs * 2 ** (attempt - 1);
  return exp / 2 + rand() * (exp / 2);
}

/**
 * Plain HTTP POST webhook sink (D15 — no signing secret in v1). Retries failed
 * deliveries with exponential backoff + jitter (`config.max_attempts`, default 5); Sink v2
 * (US2, T121) removes this internal retry loop in favor of the shared `DeliveryPump`.
 * `probe()` is a bare `POST {}` bounded by `config.timeout_ms`, with the secret headers
 * attached, used to tell "unreachable" from "TLS problem" apart (research R11).
 */
export class WebhookSink implements Sink {
  readonly type = "webhook" as const;
  private readonly rand: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseDelayMs: number;

  constructor(
    readonly name: string,
    private readonly config: WebhookConnectionConfig,
    private readonly secrets: WebhookConnectionSecrets | null = null,
    overrides: { rand?: () => number; sleep?: (ms: number) => Promise<void>; baseDelayMs?: number } = {},
  ) {
    this.rand = overrides.rand ?? Math.random;
    this.sleep = overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.baseDelayMs = overrides.baseDelayMs ?? 200;
  }

  private get headers(): Record<string, string> {
    return this.secrets?.headers ?? {};
  }

  async publish(
    payload: Record<string, unknown>,
    envelope: SinkDeliveryEnvelope,
  ): Promise<SinkPublishResult> {
    const body = JSON.stringify({ ...payload, delivery_id: envelope.delivery_id, ts: envelope.ts });
    let lastError = "unknown error";
    const maxAttempts = this.config.max_attempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(this.config.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...this.headers },
          body,
          signal: AbortSignal.timeout(this.config.timeout_ms),
        });
        if (response.ok) return { ok: true };
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = (error as Error).message;
      }
      if (attempt < maxAttempts) {
        await this.sleep(jitteredBackoffMs(attempt, this.baseDelayMs, this.rand));
      }
    }
    return { ok: false, error: lastError };
  }

  async probe(): Promise<ProbeResult> {
    const startedAt = Date.now();
    const latency = () => Date.now() - startedAt;
    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers },
        body: "{}",
        signal: AbortSignal.timeout(this.config.timeout_ms),
      });
      return {
        ok: response.ok,
        stage: "done",
        detail: `HTTP ${response.status}`,
        latency_ms: latency(),
      };
    } catch (error) {
      const err = error as Error;
      const message = err.message;
      if (err.name === "TimeoutError" || /timed? ?out|timeout/i.test(message)) {
        return { ok: false, stage: "connect", detail: `Timed out after ${this.config.timeout_ms}ms`, latency_ms: latency() };
      }
      if (/certificate|ssl|tls/i.test(message)) {
        return { ok: false, stage: "tls", detail: message, latency_ms: latency() };
      }
      if (/enotfound|getaddrinfo/i.test(message)) {
        return { ok: false, stage: "resolve", detail: message, latency_ms: latency() };
      }
      return { ok: false, stage: "connect", detail: message, latency_ms: latency() };
    }
  }

  async close(): Promise<void> {
    // No persistent connection to release — each publish is a standalone HTTP request.
  }
}

export const webhookSinkFactory: SinkFactory<WebhookConnectionConfig, WebhookConnectionSecrets> = {
  type: "webhook",
  configSchema: webhookConfigSchema,
  secretsSchema: webhookSecretsSchema,
  create(name, config, secrets) {
    return new WebhookSink(name, config, secrets);
  },
};
