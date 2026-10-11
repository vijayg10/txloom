import path from "node:path";
import { getHeapStatistics } from "node:v8";
import { mkdir, writeFile } from "node:fs/promises";
import type { SimulationSpec } from "@txloom/spec";
import {
  ENGINE_VERSION,
  ImperfectionTransformer,
  checkpointWorld,
  deriveNamedRng,
  initPartitionWorld,
  simulateDay,
  toRealismStats,
  writeCheckpointFile,
  type CheckpointRef,
  type Delivered,
  type LabelRecord,
} from "@txloom/engine";
// Deep import, not the `@txloom/sinks` barrel: that barrel re-exports the Kafka
// producer too, which loads a native addon at module top level. Piscina spawns
// one fresh worker thread per partition, and multiple threads dlopen'ing the
// same native addon for the first time concurrently races and throws "Module
// did not self-register" — this worker only ever needs the parquet writer.
import {
  ParquetStreamWriter,
  TRUTH_EVENT_SCHEMA,
  LABEL_RECORD_SCHEMA,
  DELIVERED_EVENT_SCHEMA,
} from "@txloom/sinks/src/file/parquet.js";
import { getMerchants } from "./merchant-cache.js";

const DAY_MS = 86_400_000;

export interface PartitionWorkerInput {
  spec: SimulationSpec;
  seed: string;
  partitionNo: number;
  partitionCount: number;
  engineVersion: number;
  runId: string;
  dataDir: string;
}

export interface PartitionWorkerResult {
  partitionNo: number;
  eventsGenerated: number;
  achievedFraudRate: number;
  checkpoint: CheckpointRef;
  /** Highest V8 heap use this thread sampled at a day boundary — what SC-007 budgets. */
  peakHeapBytes: number;
}

/** Heap in use by this thread's isolate (not the whole process, which other threads share).
 * Benchmarks start node with `--expose-gc`, which makes the sample a live-set measurement. */
function sampleHeapBytes(): number {
  (globalThis as { gc?: () => void }).gc?.();
  return getHeapStatistics().used_heap_size;
}

function corruptionRow(label: LabelRecord): Record<string, unknown> {
  return {
    ...label,
    corruption_detail: label.corruption_detail ? JSON.stringify(label.corruption_detail) : null,
  };
}

interface SinkOutput {
  transformer: ImperfectionTransformer;
  delivered: ParquetStreamWriter;
  deliveredLabels: ParquetStreamWriter;
  corruptions: ParquetStreamWriter;
}

async function writeDelivered(output: SinkOutput, batch: readonly Delivered[]): Promise<void> {
  for (const d of batch) {
    await output.delivered.append(d.payload as unknown as Record<string, unknown>);
    await output.deliveredLabels.append(corruptionRow(d.fraudLabel));
    for (const corruption of d.corruptions) {
      await output.corruptions.append(corruptionRow(corruption));
    }
  }
}

/** Piscina worker-thread entry point (constitution Principle V: CPU-bound generation must
 * never run on the API event loop). Simulates one partition a day at a time (R6), streaming
 * each day to incremental Parquet writers so memory stays flat however long the history is,
 * then writes the end-of-history world checkpoint the live phase restores (R7).
 *
 * Output per partition (data-model.md §3): `truth/` and `labels/` are written in lockstep (row i
 * of each is the same event). Each output sink has its own imperfection transformer (R9) that
 * writes `delivered/<sink>/part-n` in delivery order, the aligned `delivered/<sink>/labels-part-n`
 * and the sink's corruption labels in `corruptions/<sink>/part-n`. */
export default async function runPartition(
  input: PartitionWorkerInput,
): Promise<PartitionWorkerResult> {
  const { spec, partitionNo } = input;
  const seed = BigInt(input.seed);
  const merchants = getMerchants(input.runId, input.engineVersion, spec, seed);
  const world = initPartitionWorld(spec, seed, partitionNo, input.partitionCount, merchants);
  const clockStartMs = Date.parse(`${spec.clock.start}T00:00:00.000Z`);

  const runDir = path.join(input.dataDir, "runs", input.runId);
  const partFile = `part-${partitionNo}.parquet`;
  const truthWriter = await ParquetStreamWriter.open(
    path.join(runDir, "truth", partFile),
    TRUTH_EVENT_SCHEMA,
  );
  const labelWriter = await ParquetStreamWriter.open(
    path.join(runDir, "labels", partFile),
    LABEL_RECORD_SCHEMA,
  );
  const sinkOutputs = new Map<string, SinkOutput>();
  for (const sink of spec.output.sinks) {
    sinkOutputs.set(sink.name, {
      transformer: ImperfectionTransformer.create(
        sink.name,
        spec.imperfections,
        deriveNamedRng(seed, `imperfections:${sink.name}:p${partitionNo}`),
      ),
      delivered: await ParquetStreamWriter.open(
        path.join(runDir, "delivered", sink.name, partFile),
        DELIVERED_EVENT_SCHEMA,
      ),
      deliveredLabels: await ParquetStreamWriter.open(
        path.join(runDir, "delivered", sink.name, `labels-${partFile}`),
        LABEL_RECORD_SCHEMA,
      ),
      corruptions: await ParquetStreamWriter.open(
        path.join(runDir, "corruptions", sink.name, partFile),
        LABEL_RECORD_SCHEMA,
      ),
    });
  }

  let peakHeapBytes = 0;
  const wallStartedAt = Date.now();
  const transformerStates: Record<string, unknown> = {};
  try {
    for (let day = 0; day < spec.clock.days; day++) {
      const { events, labels } = simulateDay(world, day);
      for (let i = 0; i < events.length; i++) {
        await truthWriter.append(events[i] as unknown as Record<string, unknown>);
        await labelWriter.append(corruptionRow(labels[i]!));
        for (const output of sinkOutputs.values()) output.transformer.push(events[i]!, labels[i]!);
      }
      const dayEndMs = clockStartMs + (day + 1) * DAY_MS - 1;
      for (const output of sinkOutputs.values()) {
        await writeDelivered(output, output.transformer.drainUntil(dayEndMs));
      }
      peakHeapBytes = Math.max(peakHeapBytes, sampleHeapBytes());
    }
    // End of history: everything still waiting (late events) is delivered now, so the history
    // stream is complete and the live phase starts from an empty transformer (R9).
    for (const [name, output] of sinkOutputs) {
      await writeDelivered(output, output.transformer.flush());
      transformerStates[name] = output.transformer.checkpoint();
    }
  } finally {
    await Promise.all([
      truthWriter.close(),
      labelWriter.close(),
      ...[...sinkOutputs.values()].flatMap((o) => [
        o.delivered.close(),
        o.deliveredLabels.close(),
        o.corruptions.close(),
      ]),
    ]);
  }
  // Streaming realism aggregates, folded day by day — report-build (report-build.ts) merges
  // these sketches instead of re-scanning the truth store (D17).
  const statsDir = path.join(runDir, "truth");
  await mkdir(statsDir, { recursive: true });
  await writeFile(
    path.join(statsDir, `part-${partitionNo}.stats.json`),
    JSON.stringify(toRealismStats(world.stats)),
  );

  // Per-partition performance record, read by the benchmarks (R18).
  await writeFile(
    path.join(statsDir, `part-${partitionNo}.perf.json`),
    JSON.stringify({
      peak_heap_bytes: peakHeapBytes,
      wall_ms: Date.now() - wallStartedAt,
      events: world.stats.eventCount,
    }),
  );

  const checkpoint = await writeCheckpointFile(
    path.join(runDir, "checkpoints", `part-${partitionNo}.v${ENGINE_VERSION}.json.gz`),
    { ...checkpointWorld(world), transformers: transformerStates },
  );

  const total = world.stats.eventCount;
  return {
    partitionNo,
    eventsGenerated: total,
    achievedFraudRate: total > 0 ? world.stats.fraudCount / total : 0,
    checkpoint,
    peakHeapBytes,
  };
}
