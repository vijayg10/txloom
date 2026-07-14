import { Worker, type ConnectionOptions, type Job } from "bullmq";
import type { SimulationSpec } from "@txloom/spec";
import {
  resumeLiveWorld,
  drawNextLiveEvent,
  liveEventLabel,
  TokenBucket,
  type LiveWorldState,
  type NamedMerchant,
  type LabelRecord,
  type TruthEvent,
} from "@txloom/engine";
import {
  kafkaSinkFactory,
  rabbitMqSinkFactory,
  webhookSinkFactory,
  type Sink,
  type KafkaSinkConfig,
  type RabbitMqSinkConfig,
  type WebhookSinkConfig,
} from "@txloom/sinks";

export type StreamDriveSinkConfig =
  | { type: "kafka"; config: KafkaSinkConfig }
  | { type: "rabbitmq"; config: RabbitMqSinkConfig }
  | { type: "webhook"; config: WebhookSinkConfig };

export interface StreamDriveJobData {
  runId: string;
  streamId: string;
  spec: SimulationSpec;
  seed: string;
  partitionCount: number;
  merchants: NamedMerchant[];
  sink: StreamDriveSinkConfig;
  labelChannelEnabled: boolean;
}

export interface StreamControlSnapshot {
  state: "idle" | "streaming" | "paused" | "stopped";
  targetTps: number;
}

export interface StreamMetrics {
  achieved_tps: number;
  target_tps: number;
  sink_lag: number;
  backpressure: boolean;
  ticker?: TruthEvent;
}

export interface StreamDriveDeps {
  connection: ConnectionOptions;
  /** Defaults to the real Kafka/RabbitMQ/webhook sink factories; injectable for tests. */
  createSink?: (sinkConfig: StreamDriveSinkConfig) => Sink;
  getStreamControl: (streamId: string) => Promise<StreamControlSnapshot>;
  onMetrics: (streamId: string, metrics: StreamMetrics) => Promise<void>;
  onLabel?: (streamId: string, label: LabelRecord) => Promise<void>;
  /** Loop tick rate, milliseconds — defaults to 200ms (5 ticks/sec). */
  tickMs?: number;
}

function defaultCreateSink(sinkConfig: StreamDriveSinkConfig): Sink {
  switch (sinkConfig.type) {
    case "kafka":
      return kafkaSinkFactory.create("stream", sinkConfig.config, null);
    case "rabbitmq":
      return rabbitMqSinkFactory.create("stream", sinkConfig.config, null);
    case "webhook":
      return webhookSinkFactory.create("stream", sinkConfig.config, null);
  }
}

const METRICS_WINDOW_MS = 1000;

/**
 * `stream-drive` BullMQ job (FR-028/029/030, D16): continues the same world
 * state (per partition, via `resumeLiveWorld`) into the live phase, metering
 * delivery through a token bucket shared across every partition so the whole
 * run converges on one target TPS. Control (pause/resume/stop, live rate
 * changes) is polled from the `streams` row each tick — the same
 * simplicity-over-event-bus choice `ws/run-progress.ts` already made for run
 * control — so world state (in-memory `LiveWorldState[]`) survives a pause
 * without needing to reload anything on resume.
 */
export function startStreamDriveWorker(deps: StreamDriveDeps): Worker<StreamDriveJobData> {
  const tickMs = deps.tickMs ?? 200;
  const createSink = deps.createSink ?? defaultCreateSink;

  return new Worker<StreamDriveJobData>(
    "stream-drive",
    async (job: Job<StreamDriveJobData>) => {
      const data = job.data;
      const seed = BigInt(data.seed);
      const worlds: LiveWorldState[] = Array.from(
        { length: data.partitionCount },
        (_, partitionNo) =>
          resumeLiveWorld(data.spec, seed, partitionNo, data.partitionCount, data.merchants),
      );
      const sink = createSink(data.sink);
      const bucket = new TokenBucket(0);

      let partitionCursor = 0;
      let deliveredInWindow = 0;
      let windowStartMs = Date.now();
      let lastBackpressure = false;
      let lastEvent: TruthEvent | undefined;

      try {
        for (;;) {
          const control = await deps.getStreamControl(data.streamId);
          if (control.state === "stopped") break;

          bucket.setRate(control.targetTps);
          bucket.refill(tickMs);

          if (control.state === "streaming") {
            const maxThisTick = Math.max(1, Math.ceil((control.targetTps * tickMs) / 1000) + 1);
            const tokens = bucket.consume(maxThisTick);
            for (let i = 0; i < tokens; i++) {
              const partitionNo = partitionCursor % worlds.length;
              partitionCursor++;
              const world = worlds[partitionNo]!;
              const event = drawNextLiveEvent(data.spec, world, partitionNo, Date.now());

              const result = await sink.publish(event as unknown as Record<string, unknown>, {
                delivery_id: event.event_id,
                event_id: event.event_id,
                ts: event.ts,
              });
              lastBackpressure = Boolean(result.backpressure);
              lastEvent = event;
              if (result.ok) deliveredInWindow++;

              if (data.labelChannelEnabled && deps.onLabel) {
                await deps.onLabel(data.streamId, liveEventLabel(event));
              }
            }
          }

          const now = Date.now();
          const elapsedMs = now - windowStartMs;
          if (elapsedMs >= METRICS_WINDOW_MS) {
            await deps.onMetrics(data.streamId, {
              achieved_tps: deliveredInWindow / (elapsedMs / 1000),
              target_tps: control.targetTps,
              sink_lag: 0,
              backpressure: lastBackpressure,
              ...(lastEvent ? { ticker: lastEvent } : {}),
            });
            deliveredInWindow = 0;
            windowStartMs = now;
          }

          await new Promise((resolve) => setTimeout(resolve, tickMs));
        }
      } finally {
        await sink.close();
      }

      return { runId: data.runId, streamId: data.streamId };
    },
    { connection: deps.connection },
  );
}
