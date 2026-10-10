import type {
  ProbeResult,
  Sink,
  SinkDeliveryEnvelope,
  SinkFactory,
  SinkPublishResult,
  SinkTarget,
} from "../interface.js";
import {
  webhookConfigSchema,
  webhookSecretsSchema,
  type WebhookConnectionConfig,
  type WebhookConnectionSecrets,
} from "./config.js";

export type { WebhookConnectionConfig as WebhookSinkConfig };

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 5;

/** Whether an HTTP status is worth retrying: request timeout, rate limiting and server errors. */
function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Plain HTTP POST webhook sink (D15 — no signing secret in v1; Sink v2). `publish` makes exactly
 * one attempt, bounded by `config.timeout_ms`, and resolves `ok` on a 2xx; retries and backoff
 * belong to the shared `DeliveryPump`, which uses `config.max_attempts`. 408, 429, 5xx and
 * network errors are retryable; other 4xx are not. `probe()` is a bare `POST {}` with the secret
 * headers attached, used to tell "unreachable" from "TLS problem" apart (research R11).
 */
export class WebhookSink implements Sink {
  readonly type = "webhook" as const;
  readonly maxInFlight = 32;

  get maxAttempts(): number {
    return this.config.max_attempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  /** A connection saved before schema defaults were applied may lack its timeout. */
  private get timeoutMs(): number {
    return this.config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  }

  constructor(
    readonly name: string,
    private readonly config: WebhookConnectionConfig,
    private readonly secrets: WebhookConnectionSecrets | null = null,
  ) {}

  private get headers(): Record<string, string> {
    return this.secrets?.headers ?? {};
  }

  async publish(
    _target: SinkTarget,
    body: Uint8Array,
    _envelope: SinkDeliveryEnvelope,
    signal: AbortSignal,
  ): Promise<SinkPublishResult> {
    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers },
        body: Buffer.from(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      });
      // Drain the body so the connection can be reused.
      await response.arrayBuffer().catch(() => {});
      if (response.ok) return { ok: true };
      return {
        ok: false,
        retryable: retryableStatus(response.status),
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return { ok: false, retryable: true, error: (error as Error).message };
    }
  }

  async probe(): Promise<ProbeResult> {
    const startedAt = Date.now();
    const latency = () => Date.now() - startedAt;
    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers },
        body: "{}",
        signal: AbortSignal.timeout(this.timeoutMs),
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
        return {
          ok: false,
          stage: "connect",
          detail: `Timed out after ${this.timeoutMs}ms`,
          latency_ms: latency(),
        };
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
