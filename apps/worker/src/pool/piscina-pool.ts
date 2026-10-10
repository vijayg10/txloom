import { availableParallelism, totalmem } from "node:os";
import path from "node:path";
import Piscina from "piscina";

const GIB = 1024 ** 3;

/** How many partitions one worker process generates at once (R4):
 * `min(cores − 1, 0.6 × RAM in GiB)`, at least 1, so N concurrent partitions can never use more
 * than ~60% of memory at the 1 GiB-per-thread budget (SC-007). `TXLOOM_MAX_WORKER_THREADS`
 * overrides it. */
export function partitionPoolSize(): number {
  const configured = Number(process.env.TXLOOM_MAX_WORKER_THREADS ?? "");
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return Math.max(1, Math.min(availableParallelism() - 1, Math.floor((0.6 * totalmem()) / GIB)));
}

let pool: Piscina | undefined;

/** worker_threads pool for CPU-bound partition generation (constitution Principle V:
 * generation must run in worker threads, never on the API event loop). */
export function getPartitionPool(): Piscina {
  if (pool) return pool;
  pool = new Piscina({
    // worker-entry.mjs loads partition-worker.ts itself via tsx's `tsImport` API —
    // see its header comment for why `execArgv: ["--import", "tsx"]` doesn't work.
    filename: path.join(import.meta.dirname, "worker-entry.mjs"),
    maxThreads: partitionPoolSize(),
  });
  return pool;
}

export async function closePartitionPool(): Promise<void> {
  await pool?.destroy();
  pool = undefined;
}
