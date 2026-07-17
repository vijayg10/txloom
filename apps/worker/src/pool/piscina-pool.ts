import path from "node:path";
import Piscina from "piscina";

let pool: Piscina | undefined;

/** worker_threads pool for CPU-bound partition generation (constitution Principle V:
 * generation must run in worker threads, never on the API event loop). The task
 * script itself (partition-worker.ts) lands with the generate-partition job (US1). */
export function getPartitionPool(): Piscina {
  if (pool) return pool;

  const configuredMax = Number(process.env.TXLOOM_MAX_WORKER_THREADS ?? "");
  const options: ConstructorParameters<typeof Piscina>[0] = {
    // worker-entry.mjs loads partition-worker.ts itself via tsx's `tsImport` API —
    // see its header comment for why `execArgv: ["--import", "tsx"]` doesn't work.
    filename: path.join(import.meta.dirname, "worker-entry.mjs"),
  };
  if (Number.isFinite(configuredMax) && configuredMax > 0) {
    options.maxThreads = configuredMax;
  }
  pool = new Piscina(options);
  return pool;
}

export async function closePartitionPool(): Promise<void> {
  await pool?.destroy();
  pool = undefined;
}
