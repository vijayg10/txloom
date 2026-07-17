import type { FastifyInstance } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import { generateMerchantPool } from "@txloom/engine";
import { getDb } from "../db/knex.js";
import { RunRepository, RunPartitionRepository } from "../db/repositories/runs.js";
import { getQueues } from "../services/queues.js";

/**
 * Run control: pause/resume/cancel. Generation granularity is per-partition
 * (not per-day), so pause/cancel act on not-yet-started partitions — an
 * already-executing partition finishes (regeneration is idempotent, D7, so
 * this never duplicates or corrupts output). Resume re-enqueues every
 * partition not yet `done`, exactly like idempotent crash resume (T096).
 */
export default async function runControlRoutes(app: FastifyInstance) {
  const db = getDb();
  const runs = new RunRepository(db);
  const runPartitions = new RunPartitionRepository(db);
  const dataDir = process.env.DATA_DIR ?? "./data";

  async function removePendingJobs(runId: string): Promise<void> {
    const partitions = await runPartitions.listByRun(runId);
    const queues = getQueues();
    for (const partition of partitions) {
      if (partition.state !== "pending") continue;
      const job = await queues.generatePartition.getJob(`${runId}-${partition.partition_no}`);
      await job?.remove();
    }
  }

  app.post("/runs/:id/pause", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await runs.getById(id);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    if (run.status !== "running") {
      reply.status(409);
      return {
        error: {
          code: "invalid_state",
          message: `Run is "${run.status}", not "running" — cannot pause.`,
        },
      };
    }

    await removePendingJobs(id);
    await runs.setStatus(id, "paused");
    return runs.getById(id);
  });

  app.post("/runs/:id/resume", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await runs.getById(id);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    if (run.status !== "paused") {
      reply.status(409);
      return {
        error: {
          code: "invalid_state",
          message: `Run is "${run.status}", not "paused" — cannot resume.`,
        },
      };
    }

    const spec = run.spec_snapshot as SimulationSpec;
    const seed = BigInt(run.seed);
    const partitions = await runPartitions.listByRun(id);
    const merchants = generateMerchantPool(spec, seed);
    const queues = getQueues();

    for (const partition of partitions) {
      if (partition.state === "done") continue;
      await queues.generatePartition.add(
        `resume-${id}-${partition.partition_no}`,
        {
          runId: id,
          spec,
          seed: seed.toString(),
          partitionNo: partition.partition_no,
          partitionCount: partitions.length,
          merchants,
          dataDir,
        },
        { jobId: `${id}-${partition.partition_no}` },
      );
    }
    await runs.setStatus(id, "running");
    return runs.getById(id);
  });

  app.post("/runs/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await runs.getById(id);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    if (run.status === "completed" || run.status === "cancelled") {
      reply.status(409);
      return { error: { code: "invalid_state", message: `Run is already "${run.status}".` } };
    }

    await removePendingJobs(id);
    await runs.setStatus(id, "cancelled");
    return runs.getById(id);
  });
}
