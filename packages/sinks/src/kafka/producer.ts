import { KafkaJS } from "@confluentinc/kafka-javascript";
import type {
  Sink,
  SinkDeliveryEnvelope,
  SinkFactory,
  SinkPublishResult,
  SinkTestResult,
} from "../interface.js";

export interface KafkaSinkConfig {
  brokers: string[];
  topic: string;
  /** Payload field used as the Kafka message key for partitioning (defaults to `consumer_id`). */
  partitionKeyField?: string;
  /** In-flight send count above this many pending deliveries reports backpressure (D16). */
  backpressureThreshold?: number;
}

interface KafkaCredentials {
  username: string;
  password: string;
}

function parseCredentials(credentials: Buffer | null): KafkaCredentials | null {
  if (!credentials) return null;
  return JSON.parse(credentials.toString("utf-8")) as KafkaCredentials;
}

/**
 * Kafka producer sink (D8): configurable partitioning by payload key,
 * delivery-report-driven backpressure. `publish()` reports
 * `backpressure: true` once too many sends are in flight at once, so the
 * stream-drive job's token bucket can slow down rather than let the
 * client-side send queue grow unbounded.
 */
export class KafkaSink implements Sink {
  readonly type = "kafka" as const;
  private readonly producer: KafkaJS.Producer;
  private readonly backpressureThreshold: number;
  private connected = false;
  private inFlight = 0;

  constructor(
    readonly name: string,
    private readonly config: KafkaSinkConfig,
    credentials: Buffer | null = null,
  ) {
    const creds = parseCredentials(credentials);
    const kafkaConfig: KafkaJS.CommonConstructorConfig = {
      kafkaJS: creds
        ? {
            brokers: config.brokers,
            clientId: `txloom-${name}`,
            ssl: true,
            sasl: { mechanism: "plain", username: creds.username, password: creds.password },
          }
        : { brokers: config.brokers, clientId: `txloom-${name}` },
    };
    const kafka = new KafkaJS.Kafka(kafkaConfig);
    this.producer = kafka.producer();
    this.backpressureThreshold = config.backpressureThreshold ?? 100;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
  }

  async publish(
    payload: Record<string, unknown>,
    envelope: SinkDeliveryEnvelope,
  ): Promise<SinkPublishResult> {
    const keyField = this.config.partitionKeyField ?? "consumer_id";
    const key = payload[keyField];
    const value = JSON.stringify({
      ...payload,
      delivery_id: envelope.delivery_id,
      ts: envelope.ts,
    });

    this.inFlight++;
    try {
      await this.ensureConnected();
      await this.producer.send({
        topic: this.config.topic,
        messages: [
          {
            key: typeof key === "string" ? key : envelope.event_id,
            value,
          },
        ],
      });
      return { ok: true, backpressure: this.inFlight > this.backpressureThreshold };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    } finally {
      this.inFlight--;
    }
  }

  async testConnection(): Promise<SinkTestResult> {
    try {
      await this.ensureConnected();
      return { ok: true, detail: `connected to ${this.config.brokers.join(",")}` };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }

  async close(): Promise<void> {
    if (this.connected) await this.producer.disconnect();
    this.connected = false;
  }
}

export const kafkaSinkFactory: SinkFactory<KafkaSinkConfig> = {
  type: "kafka",
  create(name, config, credentials) {
    return new KafkaSink(name, config, credentials);
  },
};
