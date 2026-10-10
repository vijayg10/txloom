import { KafkaJS } from "@confluentinc/kafka-javascript";
import type {
  ProbeResult,
  Sink,
  SinkDeliveryEnvelope,
  SinkFactory,
  SinkPublishResult,
  SinkTarget,
} from "../interface.js";
import { kafkaConfigSchema, kafkaSecretsSchema, type KafkaConnectionConfig, type KafkaConnectionSecrets } from "./config.js";

export type { KafkaConnectionConfig as KafkaSinkConfig };

function librdkafkaConfig(
  config: KafkaConnectionConfig,
  secrets: KafkaConnectionSecrets | null,
): KafkaJS.CommonConstructorConfig {
  // librdkafka top-level properties, NOT the `kafkaJS` block — SSL/SASL settings must sit
  // outside `kafkaJS` per the Confluent migration guide (research R10), which is also what
  // removes the old forced `ssl:true` with SASL PLAIN.
  return {
    "bootstrap.servers": config.bootstrap_servers.join(","),
    "security.protocol": config.security_protocol.toLowerCase() as
      | "plaintext"
      | "ssl"
      | "sasl_plaintext"
      | "sasl_ssl",
    ...(config.sasl_mechanism ? { "sasl.mechanisms": config.sasl_mechanism } : {}),
    ...(secrets ? { "sasl.username": secrets.username, "sasl.password": secrets.password } : {}),
    ...(config.ca_pem ? { "ssl.ca.pem": config.ca_pem } : {}),
    // The `kafkaJS` block still requires `brokers` by its own type even though the
    // top-level `bootstrap.servers` above is what the client actually connects with.
    kafkaJS: { brokers: config.bootstrap_servers, clientId: "txloom" },
  };
}

/**
 * Kafka producer sink (D8, research R10/R11): configurable partitioning by payload key,
 * delivery-report-driven backpressure, and a `probe()` that checks the target topic
 * through an `AdminClient` sharing the producer's connection.
 */
export class KafkaSink implements Sink {
  readonly type = "kafka" as const;
  private readonly producer: KafkaJS.Producer;
  private readonly backpressureThreshold = 100;
  private connected = false;
  private inFlight = 0;

  constructor(
    readonly name: string,
    private readonly config: KafkaConnectionConfig,
    private readonly secrets: KafkaConnectionSecrets | null = null,
  ) {
    const kafka = new KafkaJS.Kafka(librdkafkaConfig(config, secrets));
    this.producer = kafka.producer();
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
    const keyField = this.config.partition_key_field ?? "consumer_id";
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
        topic: this.config.default_topic,
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

  async probe(target: SinkTarget): Promise<ProbeResult> {
    const startedAt = Date.now();
    const topicName = target.topic ?? this.config.default_topic;
    const latency = () => Date.now() - startedAt;

    try {
      await this.ensureConnected();
    } catch (error) {
      const message = (error as Error).message;
      const stage = classifyConnectError(message, this.config);
      return { ok: false, stage, detail: message, latency_ms: latency() };
    }

    try {
      const kafkaAdmin = new KafkaJS.Kafka(librdkafkaConfig(this.config, this.secrets)).admin();
      await kafkaAdmin.connect();
      try {
        const { topics } = await kafkaAdmin.fetchTopicMetadata({
          topics: [topicName],
          timeout: 10_000,
        });
        const topic = topics.find((t) => t.name === topicName);
        if (!topic || topic.partitions.length === 0) {
          return {
            ok: false,
            stage: "topic",
            detail: `Topic "${topicName}" does not exist and could not be auto-created.`,
            topic: { name: topicName, exists: false },
            latency_ms: latency(),
          };
        }
        return {
          ok: true,
          stage: "done",
          detail: `Connected. Topic "${topicName}" has ${topic.partitions.length} partition(s).`,
          topic: { name: topicName, exists: true, partitions: topic.partitions.length },
          latency_ms: latency(),
        };
      } finally {
        await kafkaAdmin.disconnect().catch(() => {});
      }
    } catch (error) {
      const message = (error as Error).message;
      if (/unknown.?topic|does not exist/i.test(message)) {
        return {
          ok: false,
          stage: "topic",
          detail: `Topic "${topicName}" does not exist and could not be auto-created.`,
          topic: { name: topicName, exists: false },
          latency_ms: latency(),
        };
      }
      return { ok: false, stage: "connect", detail: message, latency_ms: latency() };
    }
  }

  async close(): Promise<void> {
    if (this.connected) await this.producer.disconnect();
    this.connected = false;
  }
}

/** Maps a connect-time failure onto the probe stage a human should look at next, based on
 * what we asked for (research R11: stage names `connect`, `tls`, `auth`). */
function classifyConnectError(message: string, config: KafkaConnectionConfig): "connect" | "tls" | "auth" {
  const lower = message.toLowerCase();
  if (/auth|sasl|credential|password/.test(lower)) return "auth";
  if (/ssl|tls|certificate|cert/.test(lower)) return "tls";
  if (config.security_protocol === "SASL_SSL" || config.security_protocol === "SASL_PLAINTEXT") {
    if (/timed? ?out|timeout/.test(lower)) return "auth";
  }
  return "connect";
}

export const kafkaSinkFactory: SinkFactory<KafkaConnectionConfig, KafkaConnectionSecrets> = {
  type: "kafka",
  configSchema: kafkaConfigSchema,
  secretsSchema: kafkaSecretsSchema,
  create(name, config, secrets) {
    return new KafkaSink(name, config, secrets);
  },
};
