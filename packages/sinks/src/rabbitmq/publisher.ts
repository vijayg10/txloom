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
 * RabbitMQ publisher (D9, research R10, Sink v2): a confirm-channel wrapper. `publish` resolves
 * only when the broker confirms the message, and a nack resolves `ok: false`. amqplib's
 * `channel.publish()` returns `false` exactly when the caller should pause until `drain` fires,
 * which surfaces as `saturated` / `waitForCapacity`. Lazy reconnect, and a `probe()` that
 * checks the target exchange.
 */
export class RabbitMqSink implements Sink {
  readonly type = "rabbitmq" as const;
  readonly maxInFlight = 256;
  private full = false;
  /** The broker raised a resource alarm (memory, disk) and blocks this connection's publishes. */
  private blocked = false;
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
    const socketOptions =
      this.config.tls && this.config.ca_pem ? { ca: [Buffer.from(this.config.ca_pem)] } : undefined;
    const connection = await amqp.connect(url, socketOptions);
    connection.on("error", () => {
      this.channel = null;
      this.connection = null;
    });
    connection.on("close", () => {
      this.channel = null;
      this.connection = null;
      this.blocked = false;
    });
    // RabbitMQ stops reading from a publishing connection while a memory or disk alarm is up and
    // says so with connection.blocked; nothing is confirmed until it unblocks.
    connection.on("blocked", () => {
      this.blocked = true;
    });
    connection.on("unblocked", () => {
      this.blocked = false;
      for (const resume of this.unblockWaiters.splice(0)) resume();
    });
    const channel = await connection.createConfirmChannel();
    // A channel-level error (publishing to a deleted exchange, say) closes the channel; pending
    // confirms are failed by amqplib, and the next publish opens a fresh channel.
    channel.on("error", () => {});
    channel.on("close", () => {
      if (this.channel === channel) this.channel = null;
    });
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

  private unblockWaiters: (() => void)[] = [];

  get saturated(): boolean {
    return this.full || this.blocked;
  }

  async waitForCapacity(): Promise<void> {
    if (this.blocked) {
      await new Promise<void>((resolve) => {
        this.unblockWaiters.push(resolve);
        // A closed connection never unblocks; do not strand the pump.
        this.connection?.once("close", () => resolve());
      });
    }
    const channel = this.channel;
    if (!this.full || !channel) return;
    await new Promise<void>((resolve) => {
      channel.once("drain", () => {
        this.full = false;
        resolve();
      });
      channel.once("close", () => resolve());
    });
  }

  async publish(
    target: SinkTarget,
    body: Uint8Array,
    _envelope: SinkDeliveryEnvelope,
    signal: AbortSignal,
  ): Promise<SinkPublishResult> {
    if (signal.aborted) return { ok: false, retryable: true, error: "aborted" };
    try {
      const channel = await this.ensureChannel();
      return await new Promise<SinkPublishResult>((resolve) => {
        const onAbort = () => resolve({ ok: false, retryable: true, error: "aborted" });
        signal.addEventListener("abort", onAbort, { once: true });
        const accepted = channel.publish(
          this.config.exchange,
          target.routing_key ?? this.config.default_routing_key,
          Buffer.from(body),
          { persistent: true },
          (error) => {
            signal.removeEventListener("abort", onAbort);
            resolve(error ? { ok: false, retryable: true, error: error.message } : { ok: true });
          },
        );
        if (!accepted) this.full = true;
      });
    } catch (error) {
      this.channel = null;
      this.connection = null;
      return { ok: false, retryable: true, error: (error as Error).message };
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
