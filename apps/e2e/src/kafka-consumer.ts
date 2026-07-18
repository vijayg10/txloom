import { KafkaJS } from "@confluentinc/kafka-javascript";

export interface ObservedKafkaMessage {
  key: string | null;
  value: Record<string, unknown>;
}

/** Host-side consumer over the demo broker's host listener (research.md R5) —
 * the worker/api publish in-network at `kafka:29092`; this observes delivery
 * from *outside* the stack at `localhost:9092`, the blackbox posture FR-004
 * wants. */
export class KafkaTestConsumer {
  private readonly kafka: KafkaJS.Kafka;
  private consumer: KafkaJS.Consumer | null = null;
  private readonly messages: ObservedKafkaMessage[] = [];

  constructor(private readonly brokers: string[] = ["localhost:9092"]) {
    this.kafka = new KafkaJS.Kafka({ kafkaJS: { brokers, clientId: "txloom-e2e" } });
  }

  async start(topic: string, groupId = `txloom-e2e-${Date.now()}`): Promise<void> {
    const admin = this.kafka.admin();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic, numPartitions: 1 }] }).catch(() => {
      // Topic may already exist (e.g. from a prior story in the same suite run) — fine.
    });
    await admin.disconnect();

    this.consumer = this.kafka.consumer({ kafkaJS: { groupId, fromBeginning: true } });
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [topic] });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.value ? message.value.toString("utf-8") : "{}";
        this.messages.push({
          key: message.key ? message.key.toString("utf-8") : null,
          value: JSON.parse(raw) as Record<string, unknown>,
        });
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer?.disconnect();
    this.consumer = null;
  }

  get received(): readonly ObservedKafkaMessage[] {
    return this.messages;
  }

  clear(): void {
    this.messages.length = 0;
  }
}
