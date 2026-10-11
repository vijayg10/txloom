import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  DeliveryPump,
  LABEL_RECORD_SCHEMA,
  ParquetStreamWriter,
  PumpBreakerError,
  countParquetRows,
  encodeWirePayload,
  listPartSegments,
  partitionKeyOf,
  readParquet,
  type DroppedLabel,
  type Sink,
} from "@txloom/sinks";
import type { RunDeliveryRepository } from "../../../api/src/db/repositories/run-deliveries.js";
import { createSinkForDestination, type StreamDriveDestination } from "./stream-drive.js";
import type { ConnectionRepository } from "../../../api/src/db/repositories/connections.js";

/** Rows delivered between cursor checkpoints (data-model.md §1.6). */
export const CHECKPOINT_ROWS = 10_000;

export interface DeliverJobData {
  runId: string;
  sinkName: string;
  destination: StreamDriveDestination;
  dataDir: string;
  engineVersion: number;
}

export interface DeliverDeps {
  connection: ConnectionOptions;
  deliveries: Pick<RunDeliveryRepository, "get" | "markRunning" | "recordProgress" | "finish">;
  connections?: ConnectionRepository;
  /** Overrides destination resolution; injectable for tests. */
  createSink?: (destination: StreamDriveDestination) => Promise<Sink> | Sink;
  /** Called after a delivery ends, whatever the outcome. */
  onDeliveryFinished?: (runId: string, sinkName: string) => Promise<void>;
  /** Lowers `CHECKPOINT_ROWS`, and the retry backoff, in tests. */
  checkpointRows?: number;
  backoff?: { baseMs: number; maxMs: number };
}

/** Number of `dropped-<k>.parquet` files already written for a sink, which is the next `k`. A
 * retry therefore never overwrites the labels of an earlier pass. */
async function nextDroppedIndex(dir: string): Promise<number> {
  try {
    return (await readdir(dir)).filter((name) => /^dropped-\d+(\.\d+)?\.parquet$/.test(name))
      .length;
  } catch {
    return 0;
  }
}

/**
 * Replays one sink's `delivered/<sink>/` to its destination (FR-021). Rows go out in partition
 * then row order through the `DeliveryPump`, unpaced, so the destination sees the delivered
 * stream exactly as written, with `delivered_at` present and `sent_at` null.
 *
 * Every 10,000 rows the pump is drained and the cursor and counts are saved, so a cursor only
 * ever points past rows that were acknowledged or labelled `dropped`. A retry therefore resumes
 * at the cursor instead of starting over. The delivery ends `done` when nothing was dropped, and
 * `failed` when something was dropped or the breaker tripped.
 */
export async function runDelivery(deps: DeliverDeps, data: DeliverJobData): Promise<void> {
  const { runId, sinkName } = data;
  const previous = await deps.deliveries.get(runId, sinkName);
  const startCursor = previous?.cursor ?? { file_index: 0, row: 0 };
  let published = previous?.published ?? 0;
  let failed = previous?.failed ?? 0;

  const deliveredDir = path.join(data.dataDir, "runs", runId, "delivered", sinkName);
  const files = await listPartSegments(deliveredDir);
  let total = 0;
  for (const file of files) total += await countParquetRows(file);
  await deps.deliveries.markRunning(runId, sinkName, total);

  const createSink =
    deps.createSink ??
    ((destination: StreamDriveDestination) => {
      if (!deps.connections) throw new Error("deliver needs a ConnectionRepository");
      return createSinkForDestination(destination, deps.connections);
    });

  let sink: Sink | undefined;
  let droppedWriter: ParquetStreamWriter | undefined;
  let droppedThisPass = 0;
  let breaker: PumpBreakerError | undefined;
  let openDroppedPath: string | undefined;
  try {
    sink = await createSink(data.destination);
    const droppedDir = path.join(data.dataDir, "runs", runId, "deliveries", sinkName);
    let droppedIndex = await nextDroppedIndex(droppedDir);
    // The open file belongs to the rows since the last checkpoint; it is closed at each
    // checkpoint and discarded if the pass ends abnormally, because a retry resumes from the
    // checkpoint and would label those same rows again.
    // The pump calls onDropped once per dropped delivery; appends are chained so rows never
    // interleave inside the writer.
    let writeChain: Promise<void> = Promise.resolve();
    const onDropped = (label: DroppedLabel): Promise<void> => {
      droppedThisPass++;
      writeChain = writeChain.then(async () => {
        if (!droppedWriter) {
          openDroppedPath = path.join(droppedDir, `dropped-${droppedIndex++}.parquet`);
          droppedWriter = await ParquetStreamWriter.open(openDroppedPath, LABEL_RECORD_SCHEMA);
        }
        await droppedWriter.append({
          ...label,
          corruption_detail: JSON.stringify(label.corruption_detail),
        });
      });
      return writeChain;
    };

    const pump = new DeliveryPump({
      sink,
      target: {
        ...(data.destination.topic ? { topic: data.destination.topic } : {}),
        ...(data.destination.routingKey ? { routing_key: data.destination.routingKey } : {}),
      },
      onDropped,
      onBreaker: (error) => {
        breaker = error;
      },
      ...(deps.backoff ? { backoff: deps.backoff } : {}),
    });

    const checkpointEvery = deps.checkpointRows ?? CHECKPOINT_ROWS;
    const basePublished = published;
    const baseFailed = failed;
    let sinceCheckpoint = 0;

    const checkpoint = async (cursor: { file_index: number; row: number }) => {
      await pump.drain();
      await writeChain;
      await droppedWriter?.close();
      droppedWriter = undefined;
      openDroppedPath = undefined;
      const metrics = pump.metrics();
      published = basePublished + metrics.delivered_total;
      failed = baseFailed + metrics.failed_total;
      await deps.deliveries.recordProgress(runId, sinkName, { cursor, published, failed });
    };

    let cursor = startCursor;
    for (let fileIndex = startCursor.file_index; fileIndex < files.length; fileIndex++) {
      let row = 0;
      const skip = fileIndex === startCursor.file_index ? startCursor.row : 0;
      for await (const record of readParquet(files[fileIndex]!)) {
        if (row++ < skip) continue;
        const accepted = await pump.submit({
          body: encodeWirePayload(record),
          envelope: {
            delivery_id: String(record.delivery_id),
            event_id: String(record.event_id),
          },
          target: {
            ...(data.destination.topic ? { topic: data.destination.topic } : {}),
            ...(data.destination.routingKey ? { routing_key: data.destination.routingKey } : {}),
            key: partitionKeyOf(record),
          },
        });
        if (!accepted) break;
        cursor = { file_index: fileIndex, row };
        if (++sinceCheckpoint >= checkpointEvery) {
          await checkpoint(cursor);
          sinceCheckpoint = 0;
        }
      }
      cursor = { file_index: fileIndex + 1, row: 0 };
    }
    await checkpoint(cursor);

    if (droppedThisPass > 0) {
      await deps.deliveries.finish(runId, sinkName, {
        state: "failed",
        error: `${droppedThisPass} deliveries could not be delivered and are labelled dropped in the answer key. Retry to continue, or skip this sink.`,
      });
    } else {
      await deps.deliveries.finish(runId, sinkName, { state: "done" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await droppedWriter?.close().catch(() => {});
    if (openDroppedPath) await rm(openDroppedPath, { force: true });
    // The cursor from the last checkpoint stays, so a retry resumes there.
    await deps.deliveries.finish(runId, sinkName, {
      state: "failed",
      error: breaker?.message ?? message,
    });
  } finally {
    await sink?.close().catch(() => {});
    await deps.onDeliveryFinished?.(runId, sinkName);
  }
}

/** `deliver` BullMQ job: history replay of one sink. One job per run and sink; a retry from the
 * API enqueues a fresh job that continues from the saved cursor. */
export function startDeliverWorker(deps: DeliverDeps): Worker<DeliverJobData> {
  return new Worker<DeliverJobData>(
    "deliver",
    async (job: Job<DeliverJobData>) => {
      await runDelivery(deps, job.data);
      return { runId: job.data.runId, sinkName: job.data.sinkName };
    },
    {
      connection: deps.connection,
      concurrency: Number(process.env.TXLOOM_MAX_DELIVERIES) || 4,
      // A replay runs for minutes; a restart hands it back instead of failing it.
      maxStalledCount: 10,
      stalledInterval: 15_000,
    },
  );
}
