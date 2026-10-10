import amqp, { type ChannelModel, type ConfirmChannel } from "amqplib";
import type {
  ProbeResult,
  Sink,
  SinkDeliveryEnvelope,
  SinkFactory,
  SinkPublishResult,
  SinkTarget,
} from "../interface.js";
import {
  rabbitConfigSchema,
  rabbitSecretsSchema,
  type RabbitConnectionConfig,
  type RabbitConnectionSecrets,
} from "./config.js";

export type { RabbitConnectionConfig as RabbitMqSinkConfig };

function buildUrl(config: RabbitConnectionConfig, secrets: RabbitConnectionSecrets | null): string {
  const scheme = config.tls ? "amqps" : "amqp";
  const auth = secrets
    ? `${encodeURIComponent(secrets.username)}:${encodeURIComponent(secrets.password)}@`
    : "";
  const vhost = encodeURIComponent(config.vhost === "/" ? "" : config.vhost);
  return `${scheme}://${auth}${config.host}:${config.port}/${vhost}`;
}

/**
 * RabbitMQ publisher (D9, research R10): a confirm-channel wrapper so `publish()`'s
 * write-buffer-full signal maps directly onto `SinkPublishResult.backpressure` — amqplib's
 * `channel.publish()` returns `false` exactly when the caller should pause until `drain`
 * fires — plus lazy reconnect, and a `probe()` that checks the target exchange.
 */
export class RabbitMqSink implements Sink {
  readonly type = "rabbitmq" as const;
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<ConfirmChannel> | null = null;

  constructor(
    readonly name: string,
    private readonly config: RabbitConnectionConfig,
    private readonly secrets: RabbitConnectionSecrets | null = null,
  ) {}

  private async connect(): Promise<ConfirmChannel> {
    const url = buildUrl(this.config, this.secrets);
    const socketOptions = this.config.tls && this.config.ca_pem
      ? { ca: [Buffer.from(this.config.ca_pem)] }
      : undefined;
    const connection = await amqp.connect(url, socketOptions);
    connection.on("error", () => {
      this.channel = null;
      this.connection = null;
    });
    connection.on("close", () => {
      this.channel = null;
      this.connection = null;
    });
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(this.config.exchange, this.config.exchange_type, {
      durable: true,
    });
    this.connection = connection;
    this.channel = channel;
    return channel;
  }

  private async ensureChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  async publish(
    payload: Record<string, unknown>,
    envelope: SinkDeliveryEnvelope,
  ): Promise<SinkPublishResult> {
    try {
      const channel = await this.ensureChannel();
      const body = Buffer.from(
        JSON.stringify({ ...payload, delivery_id: envelope.delivery_id, ts: envelope.ts }),
      );
      const ok = channel.publish(this.config.exchange, this.config.default_routing_key, body, {
        persistent: true,
      });
      return { ok: true, backpressure: !ok };
    } catch (error) {
      this.channel = null;
      this.connection = null;
      return { ok: false, error: (error as Error).message };
    }
  }

  async probe(target: SinkTarget): Promise<ProbeResult> {
    const startedAt = Date.now();
    const latency = () => Date.now() - startedAt;
    try {
      const channel = await this.ensureChannel();
      if (target.routing_key) {
        // checkExchange only confirms the exchange exists; binding/queue existence is the
        // consumer's concern, so there is nothing further to check for a routing key.
        await channel.checkExchange(this.config.exchange);
      }
      return {
        ok: true,
        stage: "done",
        detail: `Connected. Exchange "${this.config.exchange}" exists.`,
        latency_ms: latency(),
      };
    } catch (error) {
      const message = (error as Error).message;
      const lower = message.toLowerCase();
      if (/auth|access.?refused|login/.test(lower)) {
        return { ok: false, stage: "auth", detail: message, latency_ms: latency() };
      }
      if (/ssl|tls|certificate/.test(lower)) {
        return { ok: false, stage: "tls", detail: message, latency_ms: latency() };
      }
      if (/not.?found|no exchange/.test(lower)) {
        return {
          ok: false,
          stage: "topic",
          detail: `Exchange "${this.config.exchange}" does not exist.`,
          topic: { name: this.config.exchange, exists: false },
          latency_ms: latency(),
        };
      }
      return { ok: false, stage: "connect", detail: message, latency_ms: latency() };
    }
  }

  async close(): Promise<void> {
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
    this.channel = null;
    this.connection = null;
  }
}

export const rabbitMqSinkFactory: SinkFactory<RabbitConnectionConfig, RabbitConnectionSecrets> = {
  type: "rabbitmq",
  configSchema: rabbitConfigSchema,
  secretsSchema: rabbitSecretsSchema,
  create(name, config, secrets) {
    return new RabbitMqSink(name, config, secrets);
  },
};
