# Sink Plugin Contract v2

**Date**: 2026-10-10 | **Plan**: [../plan.md](../plan.md) | **Research**: R10–R12

This is the documented extension interface for delivery targets (FR-027, constitution I). It
replaces the v1 interface in `packages/sinks/src/interface.ts`. **v2 is breaking for
third-party sinks** and is recorded in the changelog with migration notes. File output does
not use this interface; it is written by the generation pipeline.

```ts
export const SINK_PLUGIN_API_VERSION = 2;

export interface SinkDeliveryEnvelope {
  delivery_id: string;   // unique per physical delivery; duplicates share event_id, not delivery_id
  event_id: string;
}

export interface SinkPublishResult {
  ok: boolean;
  /** Only meaningful when ok=false. `retryable:false` → the pump drops immediately. */
  retryable?: boolean;
  error?: string;
}

export type ProbeStage = "resolve" | "connect" | "tls" | "auth" | "topic" | "done";

export interface ProbeResult {
  ok: boolean;
  stage: ProbeStage;            // last stage reached (failed stage when ok=false)
  detail: string;               // human-readable, states what to check (FR-010 / US1-3)
  topic?: {                     // Kafka / RabbitMQ target existence check
    name: string;
    exists: boolean;
    partitions?: number;
    auto_create_allowed?: boolean;
    retention_ms?: number | null;
  };
  latency_ms: number;
}

export interface Sink {
  readonly type: "kafka" | "rabbitmq" | "webhook" | string;
  readonly name: string;
  /** Max concurrent unacknowledged publishes the pump may keep outstanding. */
  readonly maxInFlight: number;

  /**
   * Resolves ONLY when the destination has acknowledged the message (Kafka delivery report,
   * RabbitMQ publisher confirm, HTTP 2xx), or with ok=false on failure. MUST NOT retry
   * internally — retries are the DeliveryPump's job. MAY be called concurrently up to
   * maxInFlight times. MUST honour `signal` (abort → resolve {ok:false, retryable:true}).
   */
  publish(target: SinkTarget, body: Uint8Array, envelope: SinkDeliveryEnvelope,
          signal: AbortSignal): Promise<SinkPublishResult>;

  /** Optional transport backpressure hint (e.g. RabbitMQ write buffer full). */
  readonly saturated?: boolean;
  /** Resolves when `saturated` clears. */
  waitForCapacity?(): Promise<void>;

  probe(target: SinkTarget): Promise<ProbeResult>;
  close(): Promise<void>;
}

/** Per-destination target inside a connection (topic, routing key). */
export interface SinkTarget {
  topic?: string;          // kafka
  routing_key?: string;    // rabbitmq
  key?: string;            // partition key value (kafka message key)
}

export interface SinkFactory<TConfig = unknown, TSecrets = unknown> {
  readonly type: string;
  readonly configSchema: object;     // JSON Schema used by Ajv in the API (typed forms, FR-007)
  readonly secretsSchema: object | null;
  create(name: string, config: TConfig, secrets: TSecrets | null): Sink;
}
```

## Built-in implementations

| Sink       | Acknowledgement                                   | `maxInFlight` default | Transport notes                                                                                                     |
| ---------- | ------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `kafka`    | `producer.send()` promise = delivery report       | 1000                  | librdkafka top-level props: `bootstrap.servers`, `security.protocol`, `sasl.mechanisms`, `sasl.username/password`, `ssl.ca.pem`; `linger.ms=5`; probe via `AdminClient.createFrom(producer)` metadata + topic config |
| `rabbitmq` | confirm-channel publish callback                  | 256                   | `saturated` when `publish()` returns false; `waitForCapacity` = `'drain'`; TLS via `amqps` + `ca` buffer               |
| `webhook`  | HTTP 2xx                                          | 32                    | `AbortSignal.any([signal, AbortSignal.timeout(timeout_ms)])`; 408/429/5xx/network → retryable; other 4xx → not retryable |

## DeliveryPump (`packages/sinks/src/pump.ts`)

The pump is shared by history replay and live streams. Its behaviour is fixed so that every
sink behaves the same way under load:

1. **In-flight window.** The pump keeps at most `maxInFlight` publishes outstanding. When
   the window is full, or `saturated` is set, that counts as **backpressure**.
2. **Retries.** A retryable failure goes into a min-heap keyed by due time: backoff is
   `min(30s, 200ms·2^(n−1))` with ±50% jitter, up to `max_attempts` (the connection's
   setting for webhooks, 5 otherwise). Due retries are interleaved with new events.
3. **Exhaustion.** When retries run out, or the error isn't retryable, the pump emits a
   label `{delivery_outcome: "dropped", corruption_type: null, corruption_detail: {error,
   attempts}, sink}` and increments `failed`. `corruption_type` stays reserved for the four
   injectable imperfections.
4. **Pacing (live only).** The pump consumes tokens from a bucket at
   `min(target_tps, aimd_rate)`:
   - `aimd_rate` halves on backpressure, with a floor of 1;
   - otherwise it recovers by `0.05·target` per second.
   Replay runs unpaced.
5. **Breaker.** If more than 50% of completions failed in the last 30 s, with at least 100
   completions, the pump stops and reports `error`.
6. **Metrics** are published every second: `achieved_tps`, `aimd_rate`, `in_flight`,
   `retry_queue`, `sink_lag`, `backpressure`, `delivered_total`, `failed_total`.

Contract tests run against a fake sink with scripted latency and failures. Integration tests
use Testcontainers for Kafka (SASL_SSL + SCRAM-SHA-512 + custom CA), RabbitMQ (blocked
connection) and a webhook server (hang, 429, 500).
