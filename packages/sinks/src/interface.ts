import type { SinkType } from "@txloom/spec";

export type { SinkType };

/** Per-delivery envelope. `delivery_id` is unique per physical delivery attempt —
 * duplicate-delivery imperfections share `event_id` but mint a new `delivery_id`
 * (data-model.md § DeliveredEvent). */
export interface SinkDeliveryEnvelope {
  delivery_id: string;
  event_id: string;
  /** Delivered timestamp — may differ from truth `ts` under late-arrival/clock-skew (FR-024/025). */
  ts: string;
}

export interface SinkPublishResult {
  ok: boolean;
  /** True when the sink wants the caller (token bucket, FR-028/D16) to slow down. */
  backpressure?: boolean;
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

/**
 * The documented extension contract every delivery target implements — file,
 * Kafka, RabbitMQ, webhook in v1, and the plugin surface for community sinks
 * beyond it (FR-027, constitution Principle I: extensibility via interfaces,
 * not conditionals threaded through the engine).
 */
export interface Sink {
  readonly type: SinkType;
  readonly name: string;
  publish(
    payload: Record<string, unknown>,
    envelope: SinkDeliveryEnvelope,
  ): Promise<SinkPublishResult>;
  /** Tests reachability (and, for Kafka/RabbitMQ, the target topic/exchange) without
   * publishing anything (FR-010, contracts/sink-plugin.md). Replaces `testConnection`. */
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
