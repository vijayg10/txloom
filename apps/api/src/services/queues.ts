import { Queue, type ConnectionOptions } from "bullmq";

function connectionOptions(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

let queues:
  | {
      generatePartition: Queue;
      streamDrive: Queue;
      reportBuild: Queue;
    }
  | undefined;

/** BullMQ queues over Redis for chunked parallel generation, streaming drive, and
 * report jobs (D3) — per-job progress, retries, pause/resume map onto run control.
 * Each Queue gets its own connection options rather than a shared client instance
 * to avoid cross-package ioredis type/version coupling with bullmq's bundled client. */
export function getQueues() {
  const connection = connectionOptions();
  queues ??= {
    generatePartition: new Queue("generate-partition", { connection }),
    streamDrive: new Queue("stream-drive", { connection }),
    reportBuild: new Queue("report-build", { connection }),
  };
  return queues;
}

export async function closeQueues(): Promise<void> {
  if (!queues) return;
  await Promise.all(Object.values(queues).map((q) => q.close()));
  queues = undefined;
}
