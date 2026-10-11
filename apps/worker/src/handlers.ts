import type { Knex } from "knex";
import { RunRepository, RunPartitionRepository } from "../../api/src/db/repositories/runs.js";
import type { getQueues } from "../../api/src/services/queues.js";
import { startDeliveries } from "../../api/src/services/delivery-service.js";
import { maybeAutoStartLive } from "../../api/src/services/stream-sessions.js";
import type { GeneratePartitionDeps } from "./jobs/generate-partition.js";

/** Weight of the newest measurement in the stored throughput. */
const THROUGHPUT_SMOOTHING = 0.3;

type Callbacks = Pick<
  GeneratePartitionDeps,
  "onPartitionRunning" | "onPartitionDone" | "onPartitionAttemptFailed" | "onPartitionFailed"
>;

/** The database side of a generate-partition job (R13): partition attempts, the checkpoint
 * reference, and the run's own lifecycle — `completed` when the last partition lands, `failed`
 * only when a partition has run out of attempts. Shared by the worker process and the tests
 * that drive the same worker. */
export function createGeneratePartitionCallbacks(deps: {
  db: Knex;
  queues: ReturnType<typeof getQueues>;
  dataDir: string;
}): Callbacks & { maybeCompleteRun: (runId: string) => Promise<void> } {
  const { db, queues, dataDir } = deps;
  const runs = new RunRepository(db);
  const runPartitions = new RunPartitionRepository(db);

  async function loadBenchmarkRefs(runId: string): Promise<Record<string, unknown> | null> {
    const run = await runs.getById(runId);
    const templateSlug = run
      ? ((await db("scenarios").where({ id: run.scenario_id }).first())?.template_slug ?? null)
      : null;
    if (!templateSlug) return null;
    const template = await db("templates").where({ slug: templateSlug }).first();
    return (template?.benchmark_refs as Record<string, unknown> | undefined) ?? null;
  }

  /** Flips a run to `completed` and kicks off report-build the moment its last partition
   * lands in `done`. */
  async function maybeCompleteRun(runId: string): Promise<void> {
    const partitions = await runPartitions.listByRun(runId);
    if (partitions.length === 0 || !partitions.every((p) => p.state === "done")) return;

    const run = await runs.getById(runId);
    if (!run || run.status !== "running") return;

    await runs.setStatus(runId, "completed");
    // History replay (FR-021) starts as soon as the history is complete.
    if (run.replay_history) await startDeliveries(db, run, dataDir);
    // A `history_then_live` run goes straight to live unless a replay is still to finish
    // (the deliver worker re-checks as each replay does) — FR-022.
    await maybeAutoStartLive(db, runId);
    const benchmarkRefs = await loadBenchmarkRefs(runId);
    await queues.reportBuild.add(
      `report-${runId}`,
      { runId, dataDir, benchmarkRefs },
      { jobId: `report-${runId}` },
    );
  }

  /** Folds one partition's measured events/s into `settings.generation_throughput`, which
   * `POST /spec/estimate` divides by (research R16). A moving average keeps one noisy
   * partition (a tiny one, or one that shared a busy host) from swinging the estimate. */
  async function recordThroughput(eventsGenerated: number, durationMs: number): Promise<void> {
    if (eventsGenerated <= 0 || durationMs <= 0) return;
    const measured = eventsGenerated / (durationMs / 1000);
    const row = await db("settings").where({ key: "generation_throughput" }).first();
    const previous = Number(row?.value);
    const next =
      Number.isFinite(previous) && previous > 0
        ? THROUGHPUT_SMOOTHING * measured + (1 - THROUGHPUT_SMOOTHING) * previous
        : measured;
    const value = JSON.stringify(Math.round(next));
    if (row) await db("settings").where({ key: "generation_throughput" }).update({ value });
    else await db("settings").insert({ key: "generation_throughput", value });
  }

  return {
    maybeCompleteRun,
    onPartitionRunning: async (data, attempt) => {
      await runPartitions.setState(data.runId, data.partitionNo, "running");
      await runPartitions.recordAttempt(data.runId, data.partitionNo, attempt, null);
    },
    onPartitionDone: async (data, result, durationMs) => {
      await runPartitions.checkpoint(
        data.runId,
        data.partitionNo,
        result.checkpoint,
        result.eventsGenerated,
      );
      await runPartitions.setState(data.runId, data.partitionNo, "done");
      await recordThroughput(result.eventsGenerated, durationMs);
      await maybeCompleteRun(data.runId);
    },
    onPartitionAttemptFailed: async (data, error, attempt) => {
      await runPartitions.recordAttempt(data.runId, data.partitionNo, attempt, error.message);
    },
    onPartitionFailed: async (data, error) => {
      await runPartitions.setState(data.runId, data.partitionNo, "failed");
      await runs.setStatus(data.runId, "failed", { error: error.message });
    },
  };
}
