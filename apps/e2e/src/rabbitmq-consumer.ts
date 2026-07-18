import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";

export interface ObservedRabbitMessage {
  routingKey: string;
  value: Record<string, unknown>;
}

/** Host-side consumer against the demo broker's host listener (research.md R5)
 * — binds a private, exclusive queue to the sink's exchange/routing key so it
 * observes exactly what an external subscriber would receive. */
export class RabbitMqTestConsumer {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private readonly messages: ObservedRabbitMessage[] = [];

  constructor(private readonly url: string = "amqp://localhost:5672") {}

  async start(
    exchange: string,
    routingKey: string,
    exchangeType: "direct" | "topic" | "fanout" = "topic",
  ): Promise<void> {
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(exchange, exchangeType, { durable: true });
    const { queue } = await this.channel.assertQueue("", { exclusive: true, autoDelete: true });
    await this.channel.bindQueue(queue, exchange, routingKey);
    await this.channel.consume(queue, (msg: ConsumeMessage | null) => {
      if (!msg) return;
      this.messages.push({
        routingKey: msg.fields.routingKey,
        value: JSON.parse(msg.content.toString("utf-8")) as Record<string, unknown>,
      });
      this.channel?.ack(msg);
    });
  }

  async stop(): Promise<void> {
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
    this.channel = null;
    this.connection = null;
  }

  get received(): readonly ObservedRabbitMessage[] {
    return this.messages;
  }

  clear(): void {
    this.messages.length = 0;
  }
}
