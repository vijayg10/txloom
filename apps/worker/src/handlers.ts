import type { Knex } from "knex";
import { RunRepository, RunPartitionRepository } from "../../api/src/db/repositories/runs.js";
import type { getQueues } from "../../api/src/services/queues.js";
import { startDeliveries } from "../../api/src/services/delivery-service.js";
import type { GeneratePartitionDeps } from "./jobs/generate-partition.js";

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
    const benchmarkRefs = await loadBenchmarkRefs(runId);
    await queues.reportBuild.add(
      `report-${runId}`,
      { runId, dataDir, benchmarkRefs },
      { jobId: `report-${runId}` },
    );
  }

  return {
    maybeCompleteRun,
    onPartitionRunning: async (data, attempt) => {
      await runPartitions.setState(data.runId, data.partitionNo, "running");
      await runPartitions.recordAttempt(data.runId, data.partitionNo, attempt, null);
    },
    onPartitionDone: async (data, result) => {
      await runPartitions.checkpoint(
        data.runId,
        data.partitionNo,
        result.checkpoint,
        result.eventsGenerated,
      );
      await runPartitions.setState(data.runId, data.partitionNo, "done");
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
