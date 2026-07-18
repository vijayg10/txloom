import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { SimulationSpec } from "@txloom/spec";
import {
  applyImperfections,
  computePartitionStats,
  derivePartitionRng,
  generatePartition,
  type LabelRecord,
  type NamedMerchant,
  type TruthEvent,
} from "@txloom/engine";
// Deep import, not the `@txloom/sinks` barrel: that barrel re-exports the Kafka
// producer too, which loads a native addon at module top level. Piscina spawns
// one fresh worker thread per partition, and multiple threads dlopen'ing the
// same native addon for the first time concurrently races and throws "Module
// did not self-register" — this worker only ever needs the parquet writer.
import {
  writeParquet,
  TRUTH_EVENT_SCHEMA,
  LABEL_RECORD_SCHEMA,
} from "@txloom/sinks/src/file/parquet.js";

export interface PartitionWorkerInput {
  spec: SimulationSpec;
  seed: string;
  partitionNo: number;
  partitionCount: number;
  merchants: NamedMerchant[];
  runId: string;
  dataDir: string;
}

export interface PartitionWorkerResult {
  partitionNo: number;
  eventsGenerated: number;
  achievedFraudRate: number;
}

function corruptionRow(label: LabelRecord): Record<string, unknown> {
  return {
    ...label,
    corruption_detail: label.corruption_detail ? JSON.stringify(label.corruption_detail) : null,
  };
}

/** Piscina worker-thread entry point (constitution Principle V: CPU-bound
 * generation must never run on the API event loop) — generates one partition,
 * applies imperfections per configured sink, and writes truth/label/delivered
 * Parquet segments to the run-output volume. */
export default async function runPartition(
  input: PartitionWorkerInput,
): Promise<PartitionWorkerResult> {
  const seed = BigInt(input.seed);
  const { truthEvents, labelRecords, achievedFraudRate } = generatePartition(
    input.spec,
    seed,
    input.partitionNo,
    input.partitionCount,
    input.merchants,
  );

  const deliveryRng = derivePartitionRng(seed, input.partitionNo);
  const { deliveredEvents, corruptionLabels } = applyImperfections(
    truthEvents,
    input.spec.output.sinks,
    input.spec.imperfections,
    deliveryRng,
  );

  const runDir = path.join(input.dataDir, "runs", input.runId);
  const partSuffix = `part-${input.partitionNo}.parquet`;

  await writeParquet(
    path.join(runDir, "truth", partSuffix),
    TRUTH_EVENT_SCHEMA,
    truthEvents as unknown as Record<string, unknown>[],
  );
  await writeParquet(
    path.join(runDir, "labels", partSuffix),
    LABEL_RECORD_SCHEMA,
    [...labelRecords, ...corruptionLabels].map(corruptionRow),
  );

  const bySink = new Map<string, TruthEvent[]>();
  for (const delivered of deliveredEvents) {
    const list = bySink.get(delivered.sink) ?? [];
    list.push({ ...delivered.payload, ts: delivered.ts, partition_no: input.partitionNo });
    bySink.set(delivered.sink, list);
  }
  for (const [sinkName, events] of bySink) {
    await writeParquet(
      path.join(runDir, "delivered", sinkName, partSuffix),
      TRUTH_EVENT_SCHEMA,
      events as unknown as Record<string, unknown>[],
    );
  }

  // Streaming realism aggregates computed in the same pass, so report-build
  // (report-build.ts) merges sketches instead of re-scanning the truth store (D17).
  const stats = computePartitionStats(truthEvents, [...labelRecords, ...corruptionLabels]);
  const statsDir = path.join(runDir, "truth");
  await mkdir(statsDir, { recursive: true });
  await writeFile(
    path.join(statsDir, `part-${input.partitionNo}.stats.json`),
    JSON.stringify(stats),
  );

  return { partitionNo: input.partitionNo, eventsGenerated: truthEvents.length, achievedFraudRate };
}
