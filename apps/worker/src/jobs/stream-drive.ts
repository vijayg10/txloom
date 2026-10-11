import { Worker, UnrecoverableError, type ConnectionOptions, type Job } from "bullmq";
import type { SimulationSpec } from "@txloom/spec";
import {
  ENGINE_VERSION,
  TokenBucket,
  type Delivered,
  type WorldCheckpoint,
  type LabelRecord,
  type TruthEvent,
} from "@txloom/engine";
import path from "node:path";
import {
  AimdPacer,
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
import {
  ThreadedLiveSource,
  type LiveChunk,
  type LiveSource,
  type LiveSourceInit,
} from "../live/live-source.js";
import {
  pruneLiveDayCheckpointsBefore,
  trimLiveDayCheckpoints,
  readLiveDayCheckpoint,
  writeLiveDayCheckpoint,
} from "../live/live-checkpoints.js";
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
  /** Continue from a previous session's day checkpoint instead of the end of history. `skip` is
   * how many of that day's deliveries the previous session had already made. */
  resume?: { sessionId: string; dayIndex: number; skip: number };
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
  /** Simulated time of the last delivery handed to the sinks (ISO). */
  sim_time?: string;
  /** The paced rate after backpressure (US7); equals the target when the destination keeps up. */
  aimd_rate?: number;
  in_flight?: number;
  /** The worker process's resident memory, for the benchmark's flat-memory check (SC-010). */
  worker_rss_bytes?: number;
  last_error?: string | null;
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
    progress: {
      delivered: number;
      failed: number;
      simTimeMs?: number;
      /** The simulated day whose checkpoint is the latest written, and how many of its
       * deliveries have been made since — what a crash resume skips. */
      lastCheckpointDay?: number;
      deliveredSinceCheckpoint?: number;
    },
  ) => Promise<void>;
  /** This session's own persisted position, if it already wrote a day checkpoint (a restart
   * after a crash resumes the same session from there). */
  getSessionResume?: (sessionId: string) => Promise<{ dayIndex: number; skip: number } | null>;
  /** Builds the source of live deliveries. Defaults to a dedicated worker thread. */
  openLiveSource?: (init: LiveSourceInit) => LiveSource | Promise<LiveSource>;
  /** The destination's breaker tripped: the stream moves to `error` and holds there until stopped. */
  onStreamError?: (streamId: string, message: string) => Promise<void>;
  /** Called when the job exits, whether the stream was stopped or the job crashed. */
  onSessionEnded?: (sessionId: string, error?: string) => Promise<void>;
  onLabel?: (streamId: string, label: LabelRecord) => Promise<void>;
  /** Loop tick rate, milliseconds — defaults to 200ms (5 ticks/sec). */
  tickMs?: number;
  /** BullMQ lock and stalled-job check timing; a killed worker's session is handed to another
   * worker once its lock lapses. Tests shorten these. */
  lockDurationMs?: number;
  stalledIntervalMs?: number;
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
      const sinkNames = data.destinations.map((d) => d.sink);

      // Where the world continues from: this session's own latest day (a restart), else the
      // previous session's final day, else the end of history (R7).
      const own = (await deps.getSessionResume?.(data.sessionId)) ?? null;
      const resume = own ? { sessionId: data.sessionId, ...own } : (data.resume ?? null);
      let checkpoints: WorldCheckpoint[] = [];
      if (resume) {
        if (!deps.dataDir) throw new Error("resuming a session needs a data directory");
        checkpoints = await readLiveDayCheckpoint(
          deps.dataDir,
          data.runId,
          resume.sessionId,
          resume.dayIndex,
          data.partitionCount,
        );
      } else {
        for (let partitionNo = 0; partitionNo < data.partitionCount; partitionNo++) {
          checkpoints.push(await deps.loadCheckpoint(data.runId, partitionNo));
        }
      }
      const sourceInit: LiveSourceInit = {
        spec: data.spec,
        seed: data.seed,
        runId: data.runId,
        engineVersion: data.engineVersion,
        checkpoints,
        sinks: sinkNames,
        skipFirstDay: resume?.skip ?? 0,
        ...(deps.dataDir && !deps.openLiveSource
          ? { checkpointTarget: { dataDir: deps.dataDir, sessionId: data.sessionId } }
          : {}),
      };
      const source = deps.openLiveSource
        ? await deps.openLiveSource(sourceInit)
        : new ThreadedLiveSource(sourceInit);
      const sinks: Sink[] = [];
      try {
        for (const destination of data.destinations) sinks.push(await createSink(destination));
      } catch (err) {
        await source.close();
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
      // Kafka destinations with a label topic also get the labels as messages (FR-030a).
      const labelPumps: (DeliveryPump | undefined)[] = [];
      let breakerError: string | undefined;
      const pacers: AimdPacer[] = [];
      sinks.forEach((sink, index) => {
        sink.setRunContext?.({
          runId: data.runId,
          sessionSeq: data.sessionSeq,
          engineVersion: data.engineVersion,
        });
        const destination = data.destinations[index]!;
        const pacer = new AimdPacer({ targetTps: 1000 });
        pacers.push(pacer);
        pumps.push(
          new DeliveryPump({
            sink,
            pacing: pacer,
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
        labelPumps.push(
          data.labelChannelEnabled && destination.labelTopic && sink.type === "kafka"
            ? new DeliveryPump({
                sink,
                target: { topic: destination.labelTopic },
                maxAttempts: 3,
                onDropped: () => {},
              })
            : undefined,
        );
      });

      let sessionError: string | undefined;
      let errorReported = false;
      let lastTickAt = Date.now();
      let windowStartMs = Date.now();
      let lastEvent: TruthEvent | undefined;
      let simTimeMs: number | undefined;
      let lastCheckpointDay = resume?.dayIndex;
      // Deliveries of the checkpointed day already made: the position a crash resume skips to.
      let deliveredSinceCheckpoint = resume?.skip ?? 0;
      const lastTotals = { delivered: 0, failed: 0 };
      const encoder = new TextEncoder();

      /** The answer-key rows for a delivery: the event's fraud label (once, from the first sink)
       * and every imperfection applied to this copy. */
      const labelsOf = (delivery: Delivered, firstSink: boolean): LabelRecord[] => {
        const rows = [...delivery.corruptions];
        const duplicate = delivery.corruptions.some((c) => c.corruption_type === "duplicate");
        if (firstSink && delivery.fraudLabel.is_fraud && !duplicate)
          rows.unshift(delivery.fraudLabel);
        return rows;
      };

      const handleChunk = async (chunk: LiveChunk): Promise<void> => {
        // Without a data directory there is nowhere to keep day checkpoints, so a later session
        // starts from the end of history instead.
        if (chunk.checkpointWrittenDay !== undefined && deps.dataDir) {
          lastCheckpointDay = chunk.checkpointWrittenDay;
          deliveredSinceCheckpoint = chunk.fromIndex;
          void pruneLiveDayCheckpointsBefore(
            deps.dataDir,
            data.runId,
            data.sessionId,
            chunk.checkpointWrittenDay,
          ).catch(() => {});
        } else if (chunk.dayCheckpoint && deps.dataDir) {
          await writeLiveDayCheckpoint(
            deps.dataDir,
            data.runId,
            data.sessionId,
            chunk.dayCheckpoint,
          );
          lastCheckpointDay = chunk.dayCheckpoint.dayIndex;
          deliveredSinceCheckpoint = chunk.fromIndex;
        }
        for (let index = 0; index < data.destinations.length; index++) {
          const destination = data.destinations[index]!;
          const pump = pumps[index]!;
          for (const delivery of chunk.bySink[destination.sink] ?? []) {
            const payload = { ...delivery.payload, sent_at: new Date().toISOString() };
            // Awaiting submit is the backpressure: it waits for a window slot.
            await pump.submit({
              body: encodeWirePayload(payload),
              envelope: { delivery_id: delivery.delivery_id, event_id: delivery.event_id },
              target: {
                ...(destination.topic ? { topic: destination.topic } : {}),
                ...(destination.routingKey ? { routing_key: destination.routingKey } : {}),
                key: partitionKeyOf(payload),
              },
            });
            lastEvent = delivery.payload;
            if (data.labelChannelEnabled) {
              for (const label of labelsOf(delivery, index === 0)) {
                await deps.onLabel?.(data.streamId, label);
                const labelPump = labelPumps[index];
                if (labelPump) {
                  await labelPump.submit({
                    body: encoder.encode(JSON.stringify(label)),
                    envelope: { delivery_id: delivery.delivery_id, event_id: delivery.event_id },
                    target: { topic: destination.labelTopic!, key: label.event_id },
                  });
                }
              }
            }
          }
        }
        deliveredSinceCheckpoint += chunk.length;
        simTimeMs = chunk.simTimeMs;
      };

      try {
        for (;;) {
          const control = await deps.getStreamControl(data.streamId);
          const superseded =
            control.currentSessionId !== undefined && control.currentSessionId !== data.sessionId;
          if (control.state === "stopped" || superseded) break;
          if (control.state === "error" && !errorReported) break;
          if (breakerError) {
            // Stop publishing but keep the session until the user stops it, so the stream
            // reads `error` with its reason instead of silently vanishing (US7).
            if (!errorReported) {
              errorReported = true;
              sessionError = breakerError;
              await deps.onStreamError?.(data.streamId, breakerError);
            }
            await new Promise((resolve) => setTimeout(resolve, tickMs));
            continue;
          }

          bucket.setRate(control.targetTps);
          for (const pacer of pacers) pacer.setTarget(control.targetTps);
          // Refill by the time that really passed: a tick also spends time publishing, so
          // assuming it lasted `tickMs` would run the stream below its target.
          const tickAt = Date.now();
          bucket.refill(tickAt - lastTickAt);
          lastTickAt = tickAt;

          if (control.state === "streaming") {
            // At most half a second's worth per tick, so catching up never becomes a burst.
            const maxThisTick = Math.max(1, Math.ceil(control.targetTps / 2));
            let remaining = bucket.consume(maxThisTick);
            while (remaining > 0) {
              const chunk = await source.take(remaining);
              await handleChunk(chunk);
              remaining -= Math.max(1, chunk.length);
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
              aimd_rate: Math.min(...pacers.map((p) => p.rate())),
              in_flight: snapshots.reduce((n, m) => n + m.in_flight, 0),
              worker_rss_bytes: process.memoryUsage().rss,
              last_error: breakerError ?? null,
              ...(simTimeMs !== undefined ? { sim_time: new Date(simTimeMs).toISOString() } : {}),
              ...(lastEvent ? { ticker: lastEvent } : {}),
            });
            lastTotals.delivered = delivered;
            lastTotals.failed = failed;
            await deps.onSessionProgress?.(data.sessionId, {
              ...lastTotals,
              ...(simTimeMs !== undefined ? { simTimeMs } : {}),
              ...(lastCheckpointDay !== undefined
                ? { lastCheckpointDay, deliveredSinceCheckpoint }
                : {}),
            });
            windowStartMs = now;
          }

          await new Promise((resolve) => setTimeout(resolve, tickMs));
        }
        // A stop is not a failure: give what is in flight a moment to settle before the sinks
        // close, but never hold a stop hostage to a destination that is down.
        await Promise.race([
          Promise.all([...pumps, ...labelPumps].map((pump) => pump?.drain())),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]).catch(() => {});
      } catch (error) {
        sessionError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        for (const pump of [...pumps, ...labelPumps]) pump?.stop();
        await source.close().catch(() => {});
        if (deps.dataDir && lastCheckpointDay !== undefined) {
          await trimLiveDayCheckpoints(
            deps.dataDir,
            data.runId,
            data.sessionId,
            lastCheckpointDay,
          ).catch(() => {});
        }
        const finals = pumps.map((pump) => pump.metrics());
        lastTotals.delivered = finals.reduce((n, m) => n + m.delivered_total, 0);
        lastTotals.failed = finals.reduce((n, m) => n + m.failed_total, 0);
        await Promise.allSettled([...droppedWriters.values()].map((w) => w.close()));
        await Promise.allSettled(sinks.map((sink) => sink.close()));
        // The final position: a new session continues from here without repeating anything.
        await deps.onSessionProgress?.(data.sessionId, {
          ...lastTotals,
          ...(simTimeMs !== undefined ? { simTimeMs } : {}),
          ...(lastCheckpointDay !== undefined
            ? { lastCheckpointDay, deliveredSinceCheckpoint }
            : {}),
        });
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
      stalledInterval: deps.stalledIntervalMs ?? 15_000,
      ...(deps.lockDurationMs ? { lockDuration: deps.lockDurationMs } : {}),
    },
  );
}
