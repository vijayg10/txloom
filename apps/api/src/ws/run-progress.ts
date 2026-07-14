import type WebSocket from "ws";
import { getDb } from "../db/knex.js";
import { RunPartitionRepository, RunRepository } from "../db/repositories/runs.js";

const POLL_INTERVAL_MS = 1000;
export const PROGRESS_SUBSCRIBE_PATTERN = /^runs\/([^/]+)\/progress$/;

/**
 * WS `runs/:id/progress` channel (contracts/api.md § WebSocket channels):
 * per-partition tick `{partition_no, state, events_generated, throughput,
 * eta}` plus `{status}` transitions. Polls run_partitions rather than
 * wiring BullMQ's own event bus — simpler, and the poll interval (1s) already
 * matches the documented tick rate.
 */
export function createRunProgressHandler(): (socket: WebSocket, runId: string) => () => void {
  const db = getDb();
  const runs = new RunRepository(db);
  const runPartitions = new RunPartitionRepository(db);

  return function subscribe(socket, runId) {
    const lastEventCounts = new Map<number, number>();
    let lastStatus: string | null = null;

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      void (async () => {
        const run = await runs.getById(runId);
        if (!run) {
          clearInterval(interval);
          return;
        }

        if (run.status !== lastStatus) {
          lastStatus = run.status;
          socket.send(JSON.stringify({ status: run.status }));
        }

        const partitions = await runPartitions.listByRun(runId);
        const totalPartitions = partitions.length;
        const donePartitions = partitions.filter((p) => p.state === "done").length;

        for (const partition of partitions) {
          const previous = lastEventCounts.get(partition.partition_no) ?? 0;
          const throughput =
            Math.max(0, partition.events_generated - previous) / (POLL_INTERVAL_MS / 1000);
          lastEventCounts.set(partition.partition_no, partition.events_generated);

          socket.send(
            JSON.stringify({
              partition_no: partition.partition_no,
              state: partition.state,
              events_generated: partition.events_generated,
              throughput,
              eta: totalPartitions > 0 ? Math.max(0, totalPartitions - donePartitions) : null,
            }),
          );
        }

        if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
          clearInterval(interval);
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  };
}
