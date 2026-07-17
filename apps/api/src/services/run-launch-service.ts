import type { SimulationSpec } from "@txloom/spec";
import { defaultPartitionCount, generateMerchantPool } from "@txloom/engine";
import type { RunMode, RunRepository, RunRow } from "../db/repositories/runs.js";
import type { RunPartitionRepository } from "../db/repositories/runs.js";
import { getQueues } from "./queues.js";

export interface LaunchGenerationInput {
  scenario_id: string;
  spec_version_id: string;
  spec: SimulationSpec;
  seed: bigint;
  params: unknown;
  mode: RunMode;
}

/**
 * Shared by POST /scenarios/:id/runs (fresh launch) and POST /runs/:id/regenerate
 * ("exactly this dataset" — FR-033): snapshots the spec, creates the run
 * + partition rows, and enqueues one generate-partition job per partition.
 */
export async function launchGeneration(
  runs: RunRepository,
  runPartitions: RunPartitionRepository,
  dataDir: string,
  input: LaunchGenerationInput,
): Promise<RunRow> {
  const run = await runs.create({
    scenario_id: input.scenario_id,
    spec_version_id: input.spec_version_id,
    spec_snapshot: input.spec,
    seed: input.seed,
    params: input.params,
    mode: input.mode,
  });

  const partitionCount = defaultPartitionCount(input.spec.population.consumers.count);
  await runPartitions.createPending(run.id, partitionCount);
  const merchants = generateMerchantPool(input.spec, input.seed);

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
        merchants,
        dataDir,
      },
      // BullMQ rejects custom job IDs containing ":" (used internally as a Redis
      // key delimiter) — keep this separator in sync with run-control.ts and
      // worker/pool/resume.ts, which look up the same job IDs.
      { jobId: `${run.id}-${partitionNo}` },
    );
  }
  await runs.setStatus(run.id, "running");

  const started = await runs.getById(run.id);
  if (!started) throw new Error("run vanished immediately after launch");
  return started;
}
