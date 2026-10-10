import { KafkaJS } from "@confluentinc/kafka-javascript";
import type {
  ProbeResult,
  Sink,
  SinkDeliveryEnvelope,
  SinkFactory,
  SinkPublishResult,
  SinkRunContext,
  SinkTarget,
} from "../interface.js";
import {
  kafkaConfigSchema,
  kafkaSecretsSchema,
  type KafkaConnectionConfig,
  type KafkaConnectionSecrets,
} from "./config.js";

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
      "plaintext" | "ssl" | "sasl_plaintext" | "sasl_ssl",
    ...(config.sasl_mechanism ? { "sasl.mechanisms": config.sasl_mechanism } : {}),
    ...(secrets ? { "sasl.username": secrets.username, "sasl.password": secrets.password } : {}),
    ...(config.ca_pem ? { "ssl.ca.pem": config.ca_pem } : {}),
    // The `kafkaJS` block still requires `brokers` by its own type even though the
    // top-level `bootstrap.servers` above is what the client actually connects with.
    kafkaJS: { brokers: config.bootstrap_servers, clientId: "txloom" },
  };
}

/**
 * Kafka producer sink (D8, research R10/R11, Sink v2): `publish` resolves on the delivery report,
 * so the pump counts only brokers' acknowledgements as delivered. Records are batched by
 * librdkafka (`linger.ms=5`, `batch.num.messages=10000`) while up to `maxInFlight` sends are
 * outstanding. `probe()` checks the target topic through an `AdminClient`.
 */
export class KafkaSink implements Sink {
  readonly type = "kafka" as const;
  readonly maxInFlight = 1000;
  private readonly producer: KafkaJS.Producer;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private headers: Record<string, string> = {};

  constructor(
    readonly name: string,
    private readonly config: KafkaConnectionConfig,
    private readonly secrets: KafkaConnectionSecrets | null = null,
  ) {
    const kafka = new KafkaJS.Kafka(librdkafkaConfig(config, secrets));
    this.producer = kafka.producer({ "linger.ms": 5, "batch.num.messages": 10_000 });
  }

  setRunContext(context: SinkRunContext): void {
    this.headers = {
      "txloom-run-id": context.runId,
      "txloom-session-seq": String(context.sessionSeq),
      "txloom-engine-version": String(context.engineVersion),
    };
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.connecting ??= this.producer.connect().then(() => {
      this.connected = true;
    });
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async publish(
    target: SinkTarget,
    body: Uint8Array,
    envelope: SinkDeliveryEnvelope,
    signal: AbortSignal,
  ): Promise<SinkPublishResult> {
    if (signal.aborted) return { ok: false, retryable: true, error: "aborted" };
    try {
      await this.ensureConnected();
      await this.producer.send({
        topic: target.topic ?? this.config.default_topic,
        messages: [
          {
            key: target.key ?? envelope.event_id,
            value: Buffer.from(body),
            headers: this.headers,
          },
        ],
      });
      return { ok: true };
    } catch (error) {
      // Broker-side failures (leader election, timeouts, queue full) clear on their own.
      return { ok: false, retryable: true, error: (error as Error).message };
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
function classifyConnectError(
  message: string,
  config: KafkaConnectionConfig,
): "connect" | "tls" | "auth" {
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
