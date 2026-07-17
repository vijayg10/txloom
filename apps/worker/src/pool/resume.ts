import type { Queue } from "bullmq";
import type { GeneratePartitionJobData } from "../jobs/generate-partition.js";

export interface IncompletePartition {
  runId: string;
  jobData: GeneratePartitionJobData;
}

/**
 * Idempotent resume on worker restart (FR-018, SC-011): re-enqueues
 * generate-partition for every partition not yet in `done` state. Because
 * generation is a pure function of (spec, seed, partitionNo, partitionCount)
 * (D7), re-running an interrupted partition overwrites its output file with
 * the identical result rather than duplicating or corrupting it.
 */
export async function resumeIncompletePartitions(
  generatePartitionQueue: Queue<GeneratePartitionJobData>,
  incomplete: readonly IncompletePartition[],
): Promise<void> {
  for (const { jobData } of incomplete) {
    await generatePartitionQueue.add(`resume-${jobData.runId}-${jobData.partitionNo}`, jobData, {
      jobId: `${jobData.runId}-${jobData.partitionNo}`,
    });
  }
}
