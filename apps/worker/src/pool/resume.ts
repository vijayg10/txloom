import type { Queue } from "bullmq";
import type { GeneratePartitionJobData } from "../jobs/generate-partition.js";

export interface IncompletePartition {
  runId: string;
  jobData: GeneratePartitionJobData;
}

/** Same retry policy as a fresh launch (kept here rather than imported from the API so the
 * worker doesn't depend on route code). */
const PARTITION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
};

/**
 * Idempotent resume on worker restart (FR-018, SC-011): re-enqueues generate-partition for
 * every partition not yet in `done` state. Because generation is a pure function of
 * (spec, seed, partitionNo, partitionCount) (D7), re-running an interrupted partition
 * overwrites its output with the identical result rather than duplicating or corrupting it.
 */
export async function resumeIncompletePartitions(
  generatePartitionQueue: Queue<GeneratePartitionJobData>,
  incomplete: readonly IncompletePartition[],
): Promise<void> {
  for (const { jobData } of incomplete) {
    await generatePartitionQueue.add(`resume-${jobData.runId}-${jobData.partitionNo}`, jobData, {
      jobId: `${jobData.runId}-${jobData.partitionNo}`,
      ...PARTITION_JOB_OPTIONS,
    });
  }
}
