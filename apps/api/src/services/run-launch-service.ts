import type { Knex } from "knex";
import type { SimulationSpec } from "@txloom/spec";
import { ENGINE_VERSION, defaultPartitionCount } from "@txloom/engine";
import {
  RunPartitionRepository,
  RunRepository,
  type RunMode,
  type RunRow,
} from "../db/repositories/runs.js";
import {
  RunDestinationRepository,
  type RunDestinationInput,
} from "../db/repositories/run-destinations.js";
import { getQueues } from "./queues.js";

export interface LaunchGenerationInput {
  scenario_id: string;
  spec_version_id: string;
  spec: SimulationSpec;
  seed: bigint;
  params: unknown;
  mode: RunMode;
  destinations?: RunDestinationInput[];
  /** Replay the history to the broker destinations after generation (FR-021). */
  replay_history?: boolean;
  /** Regenerate reuses the source run's partition count so output stays byte-identical
   * even if `TXLOOM_PARTITION_CHUNK_SIZE` changed since. */
  partition_count?: number;
  source_run_id?: string;
}

/** Each partition is tried three times with exponential backoff before the run fails (R13). */
export const PARTITION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
};

/**
 * Shared by POST /scenarios/:id/runs (fresh launch) and POST /runs/:id/regenerate
 * ("exactly this dataset" — FR-033). Launch is atomic (R13): one transaction inserts the run
 * as `running`, its partitions and its destinations, and only after the commit are the jobs
 * enqueued. If enqueueing fails the run is marked `failed` with the reason, instead of being
 * left `queued` forever with nothing to run it.
 */
export async function launchGeneration(
  db: Knex,
  dataDir: string,
  input: LaunchGenerationInput,
): Promise<RunRow> {
  const chunkSize = Number(process.env.TXLOOM_PARTITION_CHUNK_SIZE) || undefined;
  const partitionCount =
    input.partition_count ??
    defaultPartitionCount(input.spec.population.consumers.count, chunkSize);

  const run = await db.transaction(async (trx) => {
    const runs = new RunRepository(trx);
    const created = await runs.create({
      scenario_id: input.scenario_id,
      spec_version_id: input.spec_version_id,
      spec_snapshot: input.spec,
      seed: input.seed,
      params: input.params,
      mode: input.mode,
      engine_version: ENGINE_VERSION,
      partition_count: partitionCount,
      replay_history: input.replay_history ?? false,
      ...(input.source_run_id ? { source_run_id: input.source_run_id } : {}),
    });
    await new RunDestinationRepository(trx).insertAll(created.id, input.destinations ?? []);
    await new RunPartitionRepository(trx).createPending(created.id, partitionCount);
    await runs.setStatus(created.id, "running");
    return created;
  });

  const runs = new RunRepository(db);
  try {
    const queues = getQueues();
    for (let partitionNo = 0; partitionNo < partitionCount; partitionNo++) {
      await queues.generatePartition.add(
        `gen-${run.id}-${partitionNo}`,
        {
          runId: run.id,
          spec: input.spec,
          seed: input.seed.toString(),
          partitionNo,
          partitionCount,
          engineVersion: ENGINE_VERSION,
          dataDir,
        },
        // BullMQ rejects custom job IDs containing ":" (used internally as a Redis
        // key delimiter) — keep this separator in sync with run-control.ts and
        // worker/pool/resume.ts, which look up the same job IDs.
        { jobId: `${run.id}-${partitionNo}`, ...PARTITION_JOB_OPTIONS },
      );
    }
  } catch (error) {
    await runs.setStatus(run.id, "failed", {
      error: `Could not queue generation: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }

  const started = await runs.getById(run.id);
  if (!started) throw new Error("run vanished immediately after launch");
  return started;
}
