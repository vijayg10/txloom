import {
  generateMerchantPool,
  generatePartition,
  resumeLiveWorld,
  drawNextLiveEvent,
  TokenBucket,
} from "@txloom/engine";
import { DeliveryPump, encodeWirePayload, kafkaSinkFactory, partitionKeyOf } from "@txloom/sinks";
import type { SimulationSpec } from "@txloom/spec";

/** A small but structurally complete spec — the benchmark exercises the same
 * stream-drive primitives (resumeLiveWorld/drawNextLiveEvent/TokenBucket,
 * the real Kafka producer) production streaming uses, just driven directly
 * rather than through BullMQ so the script has no Redis dependency. */
export function benchmarkSpec(): SimulationSpec {
  return {
    seed: 1,
    currency: "INR",
    locale: "en-IN",
    channel: "upi",
    clock: { start: "2026-01-01", days: 7, then_stream_tps: 1000 },
    population: {
      consumers: {
        count: 2000,
        archetypes: [
          {
            name: "salaried",
            weight: 1,
            income_pattern: {
              kind: "fixed_credit_day",
              day_of_month: 1,
              amount_mean: 50000,
              amount_stddev: 5000,
            },
            spend_rhythm: {
              daily_transaction_count_mean: 2,
              daily_transaction_count_stddev: 1,
              weekend_multiplier: 1.2,
            },
          },
        ],
      },
      merchants: {
        count: 200,
        categories: {
          grocery: {
            name: "grocery",
            weight: 1,
            amount_distribution: { kind: "lognormal", mean: 500, stddev: 100 },
          },
        },
      },
    },
    seasonality: [],
    fraud: { target_rate: 0.01, typologies: [] },
    outcomes: { baseline_decline_rate: 0.02 },
    imperfections: {},
    output: { sinks: [{ type: "kafka", name: "bench" }], labels: "separate_export" },
  };
}

export interface BenchmarkOptions {
  targetTps: number;
  durationMs: number;
  brokers: string[];
  topic: string;
  partitionCount?: number;
  /** Sampling interval for RSS memory snapshots, ms. */
  memorySampleIntervalMs?: number;
}

export interface BenchmarkResult {
  target_tps: number;
  achieved_tps: number;
  duration_s: number;
  delivered_events: number;
  /** RSS memory samples across the run, MB — flat (not growing) demonstrates
   * constitution Principle V's "memory usage MUST stay flat with respect to
   * run length" for the streaming path. */
  memory_rss_mb: number[];
}

/** Drives a real Kafka producer at a token-bucket-metered target TPS for a
 * fixed wall-clock duration and reports achieved throughput + RSS memory
 * samples. Requires a reachable Kafka broker (KAFKA_BROKERS). */
export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const spec = benchmarkSpec();
  const seed = BigInt(spec.seed);
  const partitionCount = options.partitionCount ?? 4;
  const merchants = generateMerchantPool(spec, seed);
  const worlds = Array.from({ length: partitionCount }, (_, partitionNo) =>
    resumeLiveWorld(
      spec,
      seed,
      generatePartition(spec, seed, partitionNo, partitionCount, merchants).worldCheckpoint,
      merchants,
    ),
  );

  const sink = kafkaSinkFactory.create(
    "bench",
    {
      bootstrap_servers: options.brokers,
      security_protocol: "PLAINTEXT",
      default_topic: options.topic,
    },
    null,
  );
  const pump = new DeliveryPump({ sink, onDropped: () => {} });
  const bucket = new TokenBucket(options.targetTps);

  const memorySamplesMb: number[] = [];
  const memoryInterval = setInterval(
    () => memorySamplesMb.push(process.memoryUsage().rss / (1024 * 1024)),
    options.memorySampleIntervalMs ?? 5000,
  );

  let delivered = 0;
  let cursor = 0;
  const startedAt = Date.now();
  let lastTick = startedAt;

  try {
    while (Date.now() - startedAt < options.durationMs) {
      const now = Date.now();
      const deltaMs = now - lastTick;
      lastTick = now;
      bucket.refill(deltaMs);

      const tokens = bucket.consume(
        Math.max(1, Math.ceil((options.targetTps * deltaMs) / 1000) + 1),
      );
      for (let i = 0; i < tokens; i++) {
        const partitionNo = cursor % worlds.length;
        cursor++;
        const world = worlds[partitionNo]!;
        const event = drawNextLiveEvent(spec, world, partitionNo, Date.now());
        const payload = {
          ...event,
          delivery_id: event.event_id,
          delivered_at: event.ts,
          sent_at: new Date().toISOString(),
        };
        // Each publish resolves on the broker's acknowledgement; they overlap up to maxInFlight.
        void pump.submit({
          body: encodeWirePayload(payload),
          envelope: { delivery_id: event.event_id, event_id: event.event_id },
          target: { key: partitionKeyOf(payload) },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await pump.drain();
  } finally {
    clearInterval(memoryInterval);
    pump.stop();
    await sink.close();
  }
  delivered = pump.metrics().delivered_total;

  const durationS = (Date.now() - startedAt) / 1000;
  return {
    target_tps: options.targetTps,
    achieved_tps: delivered / durationS,
    duration_s: durationS,
    delivered_events: delivered,
    memory_rss_mb: memorySamplesMb,
  };
}
