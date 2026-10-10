import { Worker, UnrecoverableError, type ConnectionOptions, type Job } from "bullmq";
import type { SimulationSpec } from "@txloom/spec";
import {
  ENGINE_VERSION,
  resumeLiveWorld,
  drawNextLiveEvent,
  liveEventLabel,
  TokenBucket,
  type LiveWorldState,
  type WorldCheckpoint,
  type LabelRecord,
  type TruthEvent,
} from "@txloom/engine";
import path from "node:path";
import {
  DeliveryPump,
  ParquetStreamWriter,
  LABEL_RECORD_SCHEMA,
  encodeWirePayload,
  partitionKeyOf,
  kafkaSinkFactory,
  rabbitMqSinkFactory,
  webhookSinkFactory,
  type DroppedLabel,
  type Sink,
} from "@txloom/sinks";
import { getMerchants } from "../pool/merchant-cache.js";
import type { ConnectionRepository } from "../../../api/src/db/repositories/connections.js";

/** One resolved-at-start destination: IDs and targets only, never secrets. */
export interface StreamDriveDestination {
  sink: string;
  connectionId: string;
  topic?: string;
  routingKey?: string;
  labelTopic?: string;
}

const FACTORIES = {
  kafka: kafkaSinkFactory,
  rabbitmq: rabbitMqSinkFactory,
  webhook: webhookSinkFactory,
};

/** Loads the destination's connection, decrypts its secrets, and builds the sink through
 * its factory. A destination's topic / routing key overrides the connection default. */
export async function createSinkForDestination(
  destination: StreamDriveDestination,
  connections: ConnectionRepository,
): Promise<Sink> {
  const row = await connections.getById(destination.connectionId);
  if (!row) {
    throw new Error(
      `Connection "${destination.connectionId}" for sink "${destination.sink}" no longer exists.`,
    );
  }
  const config = { ...(row.config as Record<string, unknown>) };
  if (row.type === "kafka" && destination.topic) config.default_topic = destination.topic;
  if (row.type === "rabbitmq" && destination.routingKey) {
    config.default_routing_key = destination.routingKey;
  }
  const secrets = connections.decryptSecrets(row);
  return FACTORIES[row.type].create(destination.sink, config as never, secrets as never);
}

export interface StreamDriveJobData {
  runId: string;
  streamId: string;
  /** The `stream_sessions` row this job runs; a job whose session is no longer current exits. */
  sessionId: string;
  /** Position of the session within its stream; carried on Kafka messages as a header. */
  sessionSeq: number;
  spec: SimulationSpec;
  seed: string;
  partitionCount: number;
  engineVersion: number;
  destinations: StreamDriveDestination[];
  labelChannelEnabled: boolean;
}

export interface StreamControlSnapshot {
  state: "idle" | "streaming" | "paused" | "stopped" | "error";
  targetTps: number;
  /** The stream's current session; a job for any other session has been superseded. */
  currentSessionId?: string | null;
}

export interface StreamMetrics {
  achieved_tps: number;
  target_tps: number;
  sink_lag: number;
  backpressure: boolean;
  ticker?: TruthEvent;
  retry_queue?: number;
  delivered_total?: number;
  failed_total?: number;
}

export interface StreamDriveDeps {
  connection: ConnectionOptions;
  /** Where failed live deliveries are written (`runs/<id>/deliveries/<sink>/`). */
  dataDir?: string;
  /** Resolves saved connections for each destination. Required unless `createSink` is given. */
  connections?: ConnectionRepository;
  /** Overrides destination resolution; injectable for tests. */
  createSink?: (destination: StreamDriveDestination) => Promise<Sink> | Sink;
  /** Loads a partition's end-of-history world checkpoint (R7): the stream continues that exact
   * world, so nothing from history is regenerated and start-up costs a file read. */
  loadCheckpoint: (runId: string, partitionNo: number) => Promise<WorldCheckpoint>;
  getStreamControl: (streamId: string) => Promise<StreamControlSnapshot>;
  onMetrics: (streamId: string, metrics: StreamMetrics) => Promise<void>;
  /** Running totals for the session, once per metrics window. */
  onSessionProgress?: (
    sessionId: string,
    progress: { delivered: number; failed: number },
  ) => Promise<void>;
  /** Called when the job exits, whether the stream was stopped or the job crashed. */
  onSessionEnded?: (sessionId: string, error?: string) => Promise<void>;
  onLabel?: (streamId: string, label: LabelRecord) => Promise<void>;
  /** Loop tick rate, milliseconds — defaults to 200ms (5 ticks/sec). */
  tickMs?: number;
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
  const createSink =
    deps.createSink ??
    ((destination: StreamDriveDestination) => {
      if (!deps.connections) throw new Error("stream-drive needs a ConnectionRepository");
      return createSinkForDestination(destination, deps.connections);
    });

  return new Worker<StreamDriveJobData>(
    "stream-drive",
    async (job: Job<StreamDriveJobData>) => {
      const data = job.data;
      if (data.engineVersion !== ENGINE_VERSION) {
        throw new UnrecoverableError(
          `Run ${data.runId} was created by engine version ${data.engineVersion}, but this worker runs version ${ENGINE_VERSION}. Regenerate the run with the current engine.`,
        );
      }
      const seed = BigInt(data.seed);
      const merchants = getMerchants(data.runId, data.engineVersion, data.spec, seed);
      const worlds: LiveWorldState[] = [];
      for (let partitionNo = 0; partitionNo < data.partitionCount; partitionNo++) {
        const checkpoint = await deps.loadCheckpoint(data.runId, partitionNo);
        worlds.push(resumeLiveWorld(data.spec, seed, checkpoint, merchants));
      }
      const sinks: Sink[] = [];
      try {
        for (const destination of data.destinations) sinks.push(await createSink(destination));
      } catch (err) {
        await Promise.allSettled(sinks.map((s) => s.close()));
        throw err;
      }
      const bucket = new TokenBucket(0);

      // Failed deliveries become `dropped` rows in `deliveries/<sink>/` (opened on first use,
      // so a healthy session leaves no files) and, with the label channel on, label messages.
      const droppedWriters = new Map<string, ParquetStreamWriter>();
      const writeDropped = async (label: DroppedLabel): Promise<void> => {
        if (deps.dataDir) {
          let writer = droppedWriters.get(label.sink);
          if (!writer) {
            writer = await ParquetStreamWriter.open(
              path.join(
                deps.dataDir,
                "runs",
                data.runId,
                "deliveries",
                label.sink,
                `dropped-live-${data.sessionId}.parquet`,
              ),
              LABEL_RECORD_SCHEMA,
            );
            droppedWriters.set(label.sink, writer);
          }
          await writer.append({
            ...label,
            corruption_detail: JSON.stringify(label.corruption_detail),
          });
        }
        if (data.labelChannelEnabled && deps.onLabel) {
          await deps.onLabel(data.streamId, label as unknown as LabelRecord);
        }
      };

      const pumps: DeliveryPump[] = [];
      let breakerError: string | undefined;
      sinks.forEach((sink, index) => {
        sink.setRunContext?.({
          runId: data.runId,
          sessionSeq: data.sessionSeq,
          engineVersion: data.engineVersion,
        });
        const destination = data.destinations[index]!;
        pumps.push(
          new DeliveryPump({
            sink,
            target: {
              ...(destination.topic ? { topic: destination.topic } : {}),
              ...(destination.routingKey ? { routing_key: destination.routingKey } : {}),
            },
            onDropped: writeDropped,
            onBreaker: (error) => {
              breakerError = error.message;
            },
          }),
        );
      });

      let sessionError: string | undefined;
      let partitionCursor = 0;
      let windowStartMs = Date.now();
      let lastEvent: TruthEvent | undefined;
      const lastTotals = { delivered: 0, failed: 0 };

      try {
        for (;;) {
          const control = await deps.getStreamControl(data.streamId);
          const superseded =
            control.currentSessionId !== undefined && control.currentSessionId !== data.sessionId;
          if (control.state === "stopped" || control.state === "error" || superseded) break;
          if (breakerError) throw new Error(breakerError);

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
              const payload = {
                ...event,
                delivery_id: event.event_id,
                delivered_at: event.ts,
                sent_at: new Date().toISOString(),
              };
              const body = encodeWirePayload(payload);
              const envelope = { delivery_id: event.event_id, event_id: event.event_id };
              // Awaiting submit is the backpressure: it waits for a window slot.
              await Promise.all(
                pumps.map((pump, index) =>
                  pump.submit({
                    body,
                    envelope,
                    target: {
                      ...(data.destinations[index]!.topic
                        ? { topic: data.destinations[index]!.topic }
                        : {}),
                      ...(data.destinations[index]!.routingKey
                        ? { routing_key: data.destinations[index]!.routingKey }
                        : {}),
                      key: partitionKeyOf(payload),
                    },
                  }),
                ),
              );
              lastEvent = event;

              if (data.labelChannelEnabled && deps.onLabel) {
                await deps.onLabel(data.streamId, liveEventLabel(event));
              }
            }
          }

          const now = Date.now();
          const elapsedMs = now - windowStartMs;
          if (elapsedMs >= METRICS_WINDOW_MS) {
            const snapshots = pumps.map((pump) => pump.metrics());
            const delivered = snapshots.reduce((n, m) => n + m.delivered_total, 0);
            const failed = snapshots.reduce((n, m) => n + m.failed_total, 0);
            await deps.onMetrics(data.streamId, {
              // Per-destination rate: each event is published to every destination.
              achieved_tps:
                snapshots.reduce((n, m) => n + m.achieved_tps, 0) / Math.max(1, snapshots.length),
              target_tps: control.targetTps,
              sink_lag: Math.max(0, ...snapshots.map((m) => m.sink_lag)),
              backpressure: snapshots.some((m) => m.backpressure),
              retry_queue: snapshots.reduce((n, m) => n + m.retry_queue, 0),
              delivered_total: delivered,
              failed_total: failed,
              ...(lastEvent ? { ticker: lastEvent } : {}),
            });
            lastTotals.delivered = delivered;
            lastTotals.failed = failed;
            await deps.onSessionProgress?.(data.sessionId, lastTotals);
            windowStartMs = now;
          }

          await new Promise((resolve) => setTimeout(resolve, tickMs));
        }
        // A stop is not a failure: give what is in flight a moment to settle before the sinks
        // close, but never hold a stop hostage to a destination that is down.
        await Promise.race([
          Promise.all(pumps.map((pump) => pump.drain())),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]).catch(() => {});
      } catch (error) {
        sessionError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        for (const pump of pumps) pump.stop();
        const finals = pumps.map((pump) => pump.metrics());
        lastTotals.delivered = finals.reduce((n, m) => n + m.delivered_total, 0);
        lastTotals.failed = finals.reduce((n, m) => n + m.failed_total, 0);
        await Promise.allSettled([...droppedWriters.values()].map((w) => w.close()));
        await Promise.allSettled(sinks.map((sink) => sink.close()));
        await deps.onSessionProgress?.(data.sessionId, lastTotals);
        await deps.onSessionEnded?.(data.sessionId, sessionError);
      }

      return { runId: data.runId, streamId: data.streamId };
    },
    {
      connection: deps.connection,
      // Several sessions run side by side in this process (R5). A worker restart leaves its
      // active jobs "stalled"; the generous limits hand them back to a worker instead of
      // failing a perfectly healthy stream (R7).
      concurrency: Number(process.env.TXLOOM_MAX_STREAMS) || 4,
      maxStalledCount: 10,
      stalledInterval: 15_000,
    },
  );
}
