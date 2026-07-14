import { Worker, type ConnectionOptions, type Job } from "bullmq";
import type { SimulationSpec } from "@txloom/spec";
import type { NamedMerchant } from "@txloom/engine";
import { getPartitionPool } from "../pool/piscina-pool.js";
import type { PartitionWorkerInput, PartitionWorkerResult } from "../pool/partition-worker.js";

export interface GeneratePartitionJobData {
  runId: string;
  spec: SimulationSpec;
  seed: string;
  partitionNo: number;
  partitionCount: number;
  merchants: NamedMerchant[];
  dataDir: string;
}

export interface GeneratePartitionDeps {
  connection: ConnectionOptions;
  onPartitionDone: (data: GeneratePartitionJobData, result: PartitionWorkerResult) => Promise<void>;
  onPartitionRunning: (data: GeneratePartitionJobData) => Promise<void>;
  onPartitionFailed: (data: GeneratePartitionJobData, error: Error) => Promise<void>;
}

/** Drives one partition's generation through the piscina thread pool
 * (constitution Principle V) — regeneration is idempotent-by-construction
 * (same seed+spec+partitionNo always reproduces the same output file), so
 * resume after a crash simply re-runs the job rather than needing mid-run
 * RNG checkpointing (D7's checkpoint machinery remains available for a finer-
 * grained resume as a documented follow-up). */
export function startGeneratePartitionWorker(
  deps: GeneratePartitionDeps,
): Worker<GeneratePartitionJobData> {
  return new Worker<GeneratePartitionJobData>(
    "generate-partition",
    async (job: Job<GeneratePartitionJobData>) => {
      const data = job.data;
      await deps.onPartitionRunning(data);
      try {
        const pool = getPartitionPool();
        const input: PartitionWorkerInput = {
          spec: data.spec,
          seed: data.seed,
          partitionNo: data.partitionNo,
          partitionCount: data.partitionCount,
          merchants: data.merchants,
          runId: data.runId,
          dataDir: data.dataDir,
        };
        const result = (await pool.run(input)) as PartitionWorkerResult;
        await job.updateProgress({
          partitionNo: data.partitionNo,
          eventsGenerated: result.eventsGenerated,
        });
        await deps.onPartitionDone(data, result);
        return result;
      } catch (error) {
        await deps.onPartitionFailed(data, error as Error);
        throw error;
      }
    },
    { connection: deps.connection },
  );
}
