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

export interface SinkTestResult {
  ok: boolean;
  detail: string;
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
  testConnection(): Promise<SinkTestResult>;
  close(): Promise<void>;
}

/** Constructs a Sink from a sink_connections row's non-secret `config` plus its
 * decrypted credentials (D14) — null for sinks with no secret (file, webhook per D15). */
export interface SinkFactory<TConfig = unknown> {
  readonly type: SinkType;
  create(name: string, config: TConfig, credentials: Buffer | null): Sink;
}
