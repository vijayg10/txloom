import type WebSocket from "ws";
import { getDb } from "../db/knex.js";
import { RunPartitionRepository, RunRepository } from "../db/repositories/runs.js";
import { RunDeliveryRepository } from "../db/repositories/run-deliveries.js";
import { StreamRepository } from "../db/repositories/streams.js";

const POLL_INTERVAL_MS = 1000;
export const PROGRESS_SUBSCRIBE_PATTERN = /^runs\/([^/]+)\/progress$/;

/**
 * WS `runs/:id/progress` channel (contracts/api.md § WebSocket channels):
 * per-partition tick `{partition_no, state, events_generated, throughput,
 * eta}` plus `{status}` transitions. Polls run_partitions rather than
 * wiring BullMQ's own event bus — simpler, and the poll interval (1s) already
 * matches the documented tick rate.
 *
 * Also carries `phase` (`generating` → `replaying` → `live` → `done`) and `deliveries[]`
 * (`{sink, state, published, failed, total}`), derived from the run, its history replays and
 * its stream. They are sent when they change, and polling continues after generation ends so
 * the replay and live phases are reported too.
 */
export function createRunProgressHandler(): (socket: WebSocket, runId: string) => () => void {
  const db = getDb();
  const runs = new RunRepository(db);
  const runPartitions = new RunPartitionRepository(db);
  const deliveriesRepo = new RunDeliveryRepository(db);
  const streams = new StreamRepository(db);

  return function subscribe(socket, runId) {
    const lastEventCounts = new Map<number, number>();
    let lastStatus: string | null = null;
    let lastPhasePayload = "";
    let ticksDone = false;

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

        if (!ticksDone) {
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
            ticksDone = true;
          }
        }

        const deliveries = await deliveriesRepo.listByRun(runId);
        const stream = await streams.getByRunId(runId);
        const phase = derivePhase(run.status, deliveries, stream?.state);
        const payload = JSON.stringify({
          phase,
          deliveries: deliveries.map((d) => ({
            sink: d.sink_name,
            state: d.state,
            published: d.published,
            failed: d.failed,
            total: d.total,
          })),
        });
        if (payload !== lastPhasePayload) {
          lastPhasePayload = payload;
          socket.send(payload);
        }

        if (run.status === "failed" || run.status === "cancelled") clearInterval(interval);
      })();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  };
}

export type RunPhase = "generating" | "replaying" | "live" | "done";

/** Where a run is in its life: generating its history, replaying it to brokers, streaming
 * live, or finished. A failed replay still counts as `replaying`: it needs a retry or a skip. */
export function derivePhase(
  runStatus: string,
  deliveries: { state: string }[],
  streamState: string | undefined,
): RunPhase {
  if (runStatus !== "completed")
    return runStatus === "failed" || runStatus === "cancelled" ? "done" : "generating";
  if (
    deliveries.some((d) => d.state === "pending" || d.state === "running" || d.state === "failed")
  ) {
    return "replaying";
  }
  if (streamState === "streaming" || streamState === "paused") return "live";
  return "done";
}
