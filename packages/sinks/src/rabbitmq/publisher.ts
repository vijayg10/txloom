import amqp, { type ChannelModel, type ConfirmChannel } from "amqplib";
import type {
  Sink,
  SinkDeliveryEnvelope,
  SinkFactory,
  SinkPublishResult,
  SinkTestResult,
} from "../interface.js";

export interface RabbitMqSinkConfig {
  url: string;
  exchange: string;
  routingKey: string;
  exchangeType?: "direct" | "topic" | "fanout";
}

/**
 * RabbitMQ publisher (D9): a confirm-channel wrapper so `publish()`'s
 * write-buffer-full signal maps directly onto `SinkPublishResult.backpressure`
 * — amqplib's `channel.publish()` returns `false` exactly when the caller
 * should pause until `drain` fires — plus lazy reconnect: a dropped
 * connection/channel is detected via `error`/`close` events and re-created on
 * the next publish rather than crashing the sink.
 */
export class RabbitMqSink implements Sink {
  readonly type = "rabbitmq" as const;
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<ConfirmChannel> | null = null;

  constructor(
    readonly name: string,
    private readonly config: RabbitMqSinkConfig,
  ) {}

  private async connect(): Promise<ConfirmChannel> {
    const connection = await amqp.connect(this.config.url);
    connection.on("error", () => {
      this.channel = null;
      this.connection = null;
    });
    connection.on("close", () => {
      this.channel = null;
      this.connection = null;
    });
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(this.config.exchange, this.config.exchangeType ?? "topic", {
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
      const ok = channel.publish(this.config.exchange, this.config.routingKey, body, {
        persistent: true,
      });
      return { ok: true, backpressure: !ok };
    } catch (error) {
      this.channel = null;
      this.connection = null;
      return { ok: false, error: (error as Error).message };
    }
  }

  async testConnection(): Promise<SinkTestResult> {
    try {
      await this.ensureChannel();
      return { ok: true, detail: `connected to exchange "${this.config.exchange}"` };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }

  async close(): Promise<void> {
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
    this.channel = null;
    this.connection = null;
  }
}

export const rabbitMqSinkFactory: SinkFactory<RabbitMqSinkConfig> = {
  type: "rabbitmq",
  create(name, config) {
    return new RabbitMqSink(name, config);
  },
};
