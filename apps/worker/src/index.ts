// Worker process entrypoint. Constructs the real BullMQ Worker instances for
// generate-partition, stream-drive, and report-build (US1/US4), wires their
// callbacks to the same DB layer the API uses, resumes any run left mid-flight
// by a previous crash, and shuts down cleanly on SIGTERM/SIGINT.
import { generateMerchantPool } from "@txloom/engine";
import type { SimulationSpec } from "@txloom/spec";
import { getDb, closeDb, migrateWithLock } from "../../api/src/db/knex.js";
import { getQueues, closeQueues } from "../../api/src/services/queues.js";
import { RunRepository, RunPartitionRepository } from "../../api/src/db/repositories/runs.js";
import { StreamRepository } from "../../api/src/db/repositories/streams.js";
import { startGeneratePartitionWorker } from "./jobs/generate-partition.js";
import { startStreamDriveWorker } from "./jobs/stream-drive.js";
import { startReportBuildWorker } from "./jobs/report-build.js";
import { resumeIncompletePartitions, type IncompletePartition } from "./pool/resume.js";
import { StreamLabelChannel } from "./jobs/stream-label-channel.js";
import { closePartitionPool } from "./pool/piscina-pool.js";

const dataDir = process.env.DATA_DIR ?? "./data";

const db = getDb();
// `docker compose up` starts api and worker together with no ordering
// dependency between them (both only wait on mysql/redis health) — without
// this, a worker boot that wins the race against the api's own migration
// crashes immediately on `resumeAfterRestart()`'s first query.
// `migrateWithLock` serializes this against the api's own boot-time
// migration (see its doc comment for why Knex's own lock isn't enough on a
// fresh database).
await migrateWithLock(db);
const runs = new RunRepository(db);
const runPartitions = new RunPartitionRepository(db);
const streams = new StreamRepository(db);
const queues = getQueues();
const connection = queues.generatePartition.opts.connection!;

async function loadBenchmarkRefs(runId: string): Promise<Record<string, unknown> | null> {
  const run = await runs.getById(runId);
  const templateSlug = run
    ? ((await db("scenarios").where({ id: run.scenario_id }).first())?.template_slug ?? null)
    : null;
  if (!templateSlug) return null;
  const template = await db("templates").where({ slug: templateSlug }).first();
  return (template?.benchmark_refs as Record<string, unknown> | undefined) ?? null;
}

/** Flips a run to `completed` and kicks off report-build the moment its last
 * partition lands in `done` — nothing else in the system currently does this
 * (FR generation was previously only wired for tests, never at boot). */
async function maybeCompleteRun(runId: string): Promise<void> {
  const partitions = await runPartitions.listByRun(runId);
  if (partitions.length === 0 || !partitions.every((p) => p.state === "done")) return;

  const run = await runs.getById(runId);
  if (!run || run.status !== "running") return;

  await runs.setStatus(runId, "completed");
  const benchmarkRefs = await loadBenchmarkRefs(runId);
  await queues.reportBuild.add(
    `report-${runId}`,
    { runId, dataDir, benchmarkRefs },
    { jobId: `report-${runId}` },
  );
}

const generatePartitionWorker = startGeneratePartitionWorker({
  connection,
  onPartitionRunning: async (data) => {
    await runPartitions.setState(data.runId, data.partitionNo, "running");
  },
  onPartitionDone: async (data, result) => {
    await runPartitions.checkpoint(data.runId, data.partitionNo, null, result.eventsGenerated);
    await runPartitions.setState(data.runId, data.partitionNo, "done");
    await maybeCompleteRun(data.runId);
  },
  onPartitionFailed: async (data, error) => {
    await runPartitions.setState(data.runId, data.partitionNo, "failed");
    await runs.setStatus(data.runId, "failed", { error: error.message });
  },
});

const streamLabelChannels = new Map<string, StreamLabelChannel>();
async function getLabelChannel(streamId: string): Promise<StreamLabelChannel | undefined> {
  let channel = streamLabelChannels.get(streamId);
  if (!channel) {
    const stream = await streams.getById(streamId);
    if (!stream) return undefined;
    channel = new StreamLabelChannel(dataDir, stream.run_id);
    streamLabelChannels.set(streamId, channel);
  }
  return channel;
}

const streamDriveWorker = startStreamDriveWorker({
  connection,
  getStreamControl: async (streamId) => {
    const stream = await streams.getById(streamId);
    if (!stream) return { state: "stopped", targetTps: 0 };
    return { state: stream.state, targetTps: stream.target_tps };
  },
  onMetrics: async (streamId, metrics) => {
    await streams.setMetrics(streamId, metrics);
  },
  onLabel: async (streamId, label) => {
    const channel = await getLabelChannel(streamId);
    await channel?.append(label);
  },
});

const reportBuildWorker = startReportBuildWorker({
  connection,
  // report.json landing on disk is the completion signal — run-report.ts reads
  // it directly, so there's no DB row to flip here.
  onReportReady: async () => {},
});

/** Boot-time resume (FR-018, SC-011): re-enqueues every partition not yet
 * `done` for runs still marked `running` from before a crash/restart, and
 * completes any run whose partitions all finished but never got flipped to
 * `completed` because the process died in between. */
async function resumeAfterRestart(): Promise<void> {
  const runningRuns = await runs.listByStatus("running");
  const incomplete: IncompletePartition[] = [];

  for (const run of runningRuns) {
    const partitions = await runPartitions.listByRun(run.id);
    if (partitions.length > 0 && partitions.every((p) => p.state === "done")) {
      await maybeCompleteRun(run.id);
      continue;
    }

    const spec = run.spec_snapshot as SimulationSpec;
    const seed = BigInt(run.seed);
    const merchants = generateMerchantPool(spec, seed);
    for (const partition of partitions) {
      if (partition.state === "done") continue;
      incomplete.push({
        runId: run.id,
        jobData: {
          runId: run.id,
          spec,
          seed: seed.toString(),
          partitionNo: partition.partition_no,
          partitionCount: partitions.length,
          merchants,
          dataDir,
        },
      });
    }
  }

  if (incomplete.length > 0) {
    await resumeIncompletePartitions(queues.generatePartition, incomplete);
  }
}

await resumeAfterRestart();
console.log("txloom worker: generate-partition, stream-drive, report-build consumers running");

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`txloom worker: received ${signal}, shutting down`);
  await Promise.all([
    generatePartitionWorker.close(),
    streamDriveWorker.close(),
    reportBuildWorker.close(),
  ]);
  await closePartitionPool();
  await closeQueues();
  await closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
