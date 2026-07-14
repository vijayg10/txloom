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
    filename: path.join(import.meta.dirname, "partition-worker.ts"),
    // Spawned worker_threads need the same TS-execution loader as the parent
    // process (started via `tsx watch src/index.ts`) since nothing here is
    // precompiled to plain JS.
    execArgv: ["--import", "tsx"],
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
