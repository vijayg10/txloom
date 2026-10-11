import { Worker, UnrecoverableError, type ConnectionOptions, type Job } from "bullmq";
import type { SimulationSpec } from "@txloom/spec";
import { ENGINE_VERSION } from "@txloom/engine";
import { getPartitionPool, partitionPoolSize } from "../pool/piscina-pool.js";
import type { PartitionWorkerInput, PartitionWorkerResult } from "../pool/partition-worker.js";

export interface GeneratePartitionJobData {
  runId: string;
  spec: SimulationSpec;
  seed: string;
  partitionNo: number;
  partitionCount: number;
  /** The engine version the run was created with; a worker on another version refuses it. */
  engineVersion: number;
  dataDir: string;
}

export interface GeneratePartitionDeps {
  connection: ConnectionOptions;
  /** `durationMs` is the wall time one pool thread spent generating the partition. */
  onPartitionDone: (
    data: GeneratePartitionJobData,
    result: PartitionWorkerResult,
    durationMs: number,
  ) => Promise<void>;
  onPartitionRunning: (data: GeneratePartitionJobData, attempt: number) => Promise<void>;
  /** Called after every failed attempt, with `final` set when no retry will follow. */
  onPartitionAttemptFailed?: (
    data: GeneratePartitionJobData,
    error: Error,
    attempt: number,
    final: boolean,
  ) => Promise<void>;
  /** Called once, on the last failure — the partition and its run are `failed`. */
  onPartitionFailed: (data: GeneratePartitionJobData, error: Error) => Promise<void>;
  /** Defaults to the piscina pool; injectable for tests. */
  runPartition?: (input: PartitionWorkerInput) => Promise<PartitionWorkerResult>;
  concurrency?: number;
}

function poolRun(input: PartitionWorkerInput): Promise<PartitionWorkerResult> {
  return getPartitionPool().run(input) as Promise<PartitionWorkerResult>;
}

/** Drives one partition's generation through the piscina thread pool (constitution
 * Principle V). Generation is idempotent by construction — the same seed, spec and partition
 * always rewrite the same files — so a retry or a crash resume simply re-runs the job.
 *
 * BullMQ retries a thrown job up to its `attempts`; the partition and run are only marked
 * failed on the final attempt or an `UnrecoverableError` (R13). `concurrency` equals the pool
 * size so that all threads stay busy (R4). */
export function startGeneratePartitionWorker(
  deps: GeneratePartitionDeps,
): Worker<GeneratePartitionJobData> {
  const runPartition = deps.runPartition ?? poolRun;

  return new Worker<GeneratePartitionJobData>(
    "generate-partition",
    async (job: Job<GeneratePartitionJobData>) => {
      const data = job.data;
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 1;

      const fail = async (error: Error, final: boolean) => {
        await deps.onPartitionAttemptFailed?.(data, error, attempt, final);
        if (final) await deps.onPartitionFailed(data, error);
      };

      if (data.engineVersion !== ENGINE_VERSION) {
        // Retrying can't help: the output would silently differ from the run's record.
        const error = new UnrecoverableError(
          `Run ${data.runId} was created by engine version ${data.engineVersion}, but this worker runs version ${ENGINE_VERSION}. Regenerate the run with the current engine.`,
        );
        await fail(error, true);
        throw error;
      }

      await deps.onPartitionRunning(data, attempt);
      try {
        const startedAt = Date.now();
        const result = await runPartition({
          spec: data.spec,
          seed: data.seed,
          partitionNo: data.partitionNo,
          partitionCount: data.partitionCount,
          engineVersion: data.engineVersion,
          runId: data.runId,
          dataDir: data.dataDir,
        });
        await job.updateProgress({
          partitionNo: data.partitionNo,
          eventsGenerated: result.eventsGenerated,
        });
        await deps.onPartitionDone(data, result, Date.now() - startedAt);
        return result;
      } catch (error) {
        await fail(error as Error, attempt >= maxAttempts);
        throw error;
      }
    },
    { connection: deps.connection, concurrency: deps.concurrency ?? partitionPoolSize() },
  );
}
