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

/** librdkafka reports the cause of a failed connection (a rejected certificate, bad SASL
 * credentials) only through its log callback; `connect()` itself later rejects with a generic
 * "broker transport failure" after a long timeout. This captures those lines so the probe can
 * name the failing stage straight away. */
const FATAL_CONNECT_RE =
  /SSL handshake failed|SASL authentication error|certificate verify failed/i;

class ConnectionErrorLog implements KafkaJS.Logger {
  readonly lines: string[] = [];
  onFatal: ((message: string) => void) | null = null;

  private record(message: string): void {
    this.lines.push(message);
    if (FATAL_CONNECT_RE.test(message)) this.onFatal?.(message);
  }
  error(message: string): void {
    this.record(message);
  }
  warn(message: string): void {
    this.record(message);
  }
  info(): void {}
  debug(): void {}
  namespace(): KafkaJS.Logger {
    return this;
  }
  setLogLevel(): void {}
}

function librdkafkaConfig(
  config: KafkaConnectionConfig,
  secrets: KafkaConnectionSecrets | null,
  logger?: KafkaJS.Logger,
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
    kafkaJS: {
      brokers: config.bootstrap_servers,
      clientId: "txloom",
      ...(logger ? { logger } : {}),
    },
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
  private readonly errorLog = new ConnectionErrorLog();

  constructor(
    readonly name: string,
    private readonly config: KafkaConnectionConfig,
    private readonly secrets: KafkaConnectionSecrets | null = null,
  ) {
    const kafka = new KafkaJS.Kafka(librdkafkaConfig(config, secrets, this.errorLog));
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
      const fatal = new Promise<never>((_resolve, reject) => {
        this.errorLog.onFatal = (message) => reject(new Error(message));
      });
      const connect = this.ensureConnected();
      connect.catch(() => {}); // it can settle after the race is lost
      await Promise.race([connect, fatal]);
    } catch (error) {
      const message = (error as Error).message;
      const stage = classifyConnectError(message, this.config);
      return { ok: false, stage, detail: message, latency_ms: latency() };
    } finally {
      this.errorLog.onFatal = null;
    }

    try {
      const kafkaAdmin = new KafkaJS.Kafka(librdkafkaConfig(this.config, this.secrets)).admin();
      await kafkaAdmin.connect();
      try {
        // The typings say `{ topics }`, but the 0.5 client resolves with the array itself.
        const metadata = (await kafkaAdmin.fetchTopicMetadata({
          topics: [topicName],
          timeout: 10_000,
        })) as
          | { topics: { name: string; partitions: unknown[] }[] }
          | { name: string; partitions: unknown[] }[];
        const topics = Array.isArray(metadata) ? metadata : metadata.topics;
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
    if (this.connected) {
      await this.producer.disconnect();
    } else if (this.connecting) {
      // A connect that never completed (bad credentials, untrusted certificate) still holds the
      // client's threads, so tear it down too. Its disconnect only settles once the connect
      // attempt times out (~30 s), so don't make the caller wait for that.
      const teardown = this.producer.disconnect().catch(() => {});
      await Promise.race([teardown, new Promise((resolve) => setTimeout(resolve, 2000))]);
    }
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
  // librdkafka names the failing step ("SSL handshake failed", "SASL authentication error"), but
  // the broker URL in the same line also says `sasl_ssl`, so match the step, not the scheme.
  if (/ssl handshake failed|certificate verify failed|certificate|tls/.test(lower)) return "tls";
  if (/authentication|credential|password|sasl authentication/.test(lower)) return "auth";
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
