import type { SinkType } from "@txloom/spec";

export type { SinkType };

/** Bumped when the `Sink` contract changes incompatibly. v2 moved acknowledgement into
 * `publish` (it resolves only once the destination confirms) and retries into the pump. */
export const SINK_PLUGIN_API_VERSION = 2;

/** Per-delivery envelope. `delivery_id` is unique per physical delivery; duplicate-delivery
 * imperfections share `event_id` but mint a new `delivery_id` (data-model.md § Delivered). */
export interface SinkDeliveryEnvelope {
  delivery_id: string;
  event_id: string;
}

export interface SinkPublishResult {
  ok: boolean;
  /** Only meaningful when `ok` is false. `retryable: false` makes the pump drop immediately. */
  retryable?: boolean;
  error?: string;
}

/** The last stage reached while probing a connection (contracts/sink-plugin.md) — ordered
 * roughly by how far the probe got before failing, so the UI can say exactly what to check. */
export type ProbeStage = "resolve" | "connect" | "tls" | "auth" | "topic" | "done";

export interface ProbeResult {
  ok: boolean;
  stage: ProbeStage;
  /** Human-readable, states what to check (FR-010 / US1-3). */
  detail: string;
  /** Kafka/RabbitMQ target existence check. */
  topic?: {
    name: string;
    exists: boolean;
    partitions?: number;
    auto_create_allowed?: boolean;
    retention_ms?: number | null;
  };
  latency_ms: number;
}

/** Per-destination target inside a connection (topic, routing key, partition key). */
export interface SinkTarget {
  topic?: string;
  routing_key?: string;
  key?: string;
}

/** Run context a sink may attach to what it publishes (Kafka headers). */
export interface SinkRunContext {
  runId: string;
  sessionSeq: number;
  engineVersion: number;
}

/**
 * The documented extension contract every delivery target implements — Kafka, RabbitMQ and
 * webhook built in, and the plugin surface for community sinks beyond them (FR-027,
 * constitution Principle I). File output does not use this interface.
 */
export interface Sink {
  readonly type: SinkType;
  readonly name: string;
  /** Most unacknowledged publishes the pump may keep outstanding. */
  readonly maxInFlight: number;
  /** Attempts per delivery before the pump drops it (webhooks take the connection's setting;
   * the default is 5). */
  readonly maxAttempts?: number;

  /**
   * Resolves ONLY once the destination has acknowledged the message (Kafka delivery report,
   * RabbitMQ publisher confirm, HTTP 2xx), or with `ok: false` on failure. MUST NOT retry
   * internally — retries belong to the `DeliveryPump`. May be called concurrently up to
   * `maxInFlight` times. MUST honour `signal`: aborting resolves `{ok: false, retryable: true}`.
   */
  publish(
    target: SinkTarget,
    body: Uint8Array,
    envelope: SinkDeliveryEnvelope,
    signal: AbortSignal,
  ): Promise<SinkPublishResult>;

  /** Transport backpressure hint (for example a full RabbitMQ write buffer). */
  readonly saturated?: boolean;
  /** Resolves once `saturated` clears. */
  waitForCapacity?(): Promise<void>;
  /** Optional: receives the run context before publishing starts. */
  setRunContext?(context: SinkRunContext): void;

  /** Tests reachability (and, for Kafka/RabbitMQ, the target topic/exchange) without
   * publishing anything (FR-010). */
  probe(target: SinkTarget): Promise<ProbeResult>;
  close(): Promise<void>;
}

/** Constructs a Sink from a connection's typed, non-secret `config` plus its decrypted
 * typed `secrets` (null for sinks with none configured). `configSchema`/`secretsSchema`
 * are the Ajv JSON Schemas the API validates connection bodies against (FR-007). */
export interface SinkFactory<TConfig = unknown, TSecrets = unknown> {
  readonly type: SinkType;
  readonly configSchema: object;
  readonly secretsSchema: object | null;
  create(name: string, config: TConfig, secrets: TSecrets | null): Sink;
}
