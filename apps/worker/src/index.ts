// Worker process entrypoint. Constructs the real BullMQ Worker instances for
// generate-partition, stream-drive, and report-build (US1/US4), wires their
// callbacks to the same DB layer the API uses, resumes any run left mid-flight
// by a previous crash, and shuts down cleanly on SIGTERM/SIGINT.
import type { SimulationSpec } from "@txloom/spec";
import { getDb, closeDb, migrateWithLock } from "../../api/src/db/knex.js";
import { getQueues, closeQueues } from "../../api/src/services/queues.js";
import { RunRepository, RunPartitionRepository } from "../../api/src/db/repositories/runs.js";
import { ConnectionRepository } from "../../api/src/db/repositories/connections.js";
import { StreamRepository } from "../../api/src/db/repositories/streams.js";
import { StreamSessionRepository } from "../../api/src/db/repositories/stream-sessions.js";
import { createGeneratePartitionCallbacks } from "./handlers.js";
import { startGeneratePartitionWorker } from "./jobs/generate-partition.js";
import { startStreamDriveWorker } from "./jobs/stream-drive.js";
import { startDeliverWorker } from "./jobs/deliver.js";
import { RunDeliveryRepository } from "../../api/src/db/repositories/run-deliveries.js";
import { deliverPayloadFor, enqueueDelivery } from "../../api/src/services/delivery-service.js";
import { maybeAutoStartLive } from "../../api/src/services/stream-sessions.js";
import { startExportBuildWorker } from "./jobs/export-build.js";
import { startReportBuildWorker } from "./jobs/report-build.js";
import { startConnectionTestWorker } from "./jobs/connection-test.js";
import { resumeIncompletePartitions, type IncompletePartition } from "./pool/resume.js";
import { readCheckpointFile, type CheckpointRef } from "@txloom/engine";
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
const streamSessions = new StreamSessionRepository(db);
const queues = getQueues();
const connection = queues.generatePartition.opts.connection!;

const generateCallbacks = createGeneratePartitionCallbacks({ db, queues, dataDir });
const { maybeCompleteRun } = generateCallbacks;

const generatePartitionWorker = startGeneratePartitionWorker({ connection, ...generateCallbacks });

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
  dataDir,
  connections: new ConnectionRepository(db, dataDir),
  loadCheckpoint: async (runId, partitionNo) => {
    const partition = (await runPartitions.listByRun(runId)).find(
      (p) => p.partition_no === partitionNo,
    );
    const raw = partition?.rng_checkpoint;
    const ref = (typeof raw === "string" ? JSON.parse(raw) : raw) as
      CheckpointRef | null | undefined;
    if (!ref?.path) {
      throw new Error(
        `Partition ${partitionNo} of run ${runId} has no world checkpoint — regenerate the run.`,
      );
    }
    return readCheckpointFile(ref);
  },
  getStreamControl: async (streamId) => {
    const stream = await streams.getById(streamId);
    if (!stream) return { state: "stopped", targetTps: 0 };
    return {
      state: stream.state,
      targetTps: stream.target_tps,
      currentSessionId: stream.current_session_id,
    };
  },
  onSessionProgress: (sessionId, progress) => streamSessions.recordProgress(sessionId, progress),
  onStreamError: async (streamId, message) => {
    await streams.setLastError(streamId, message);
    await streams.setState(streamId, "error");
  },
  getSessionResume: async (sessionId) => {
    const session = await streamSessions.getById(sessionId);
    if (session?.last_checkpoint_day == null) return null;
    return {
      dayIndex: Number(session.last_checkpoint_day),
      skip: Number(session.delivered_since_checkpoint ?? 0),
    };
  },
  onSessionEnded: (sessionId, error) => streamSessions.end(sessionId, error),
  onMetrics: async (streamId, metrics) => {
    await streams.setMetrics(streamId, metrics);
  },
  onLabel: async (streamId, label) => {
    const channel = await getLabelChannel(streamId);
    await channel?.append(label);
  },
});

const deliverWorker = startDeliverWorker({
  connection,
  deliveries: new RunDeliveryRepository(db),
  connections: new ConnectionRepository(db, dataDir),
  // The last replay finishing is what releases a `history_then_live` run into live (FR-022).
  onDeliveryFinished: async (runId) => {
    await maybeAutoStartLive(db, runId);
  },
});

const exportBuildWorker = startExportBuildWorker({ connection });

const reportBuildWorker = startReportBuildWorker({
  connection,
  // report.json landing on disk is the completion signal — run-report.ts reads
  // it directly, so there's no DB row to flip here.
  onReportReady: async () => {},
});

const connectionTestWorker = startConnectionTestWorker({ connection });

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
    for (const partition of partitions) {
      if (partition.state === "done") continue;
      incomplete.push({
        runId: run.id,
        jobData: {
          runId: run.id,
          spec,
          seed: run.seed,
          partitionNo: partition.partition_no,
          partitionCount: run.partition_count,
          engineVersion: run.engine_version,
          dataDir,
        },
      });
    }
  }

  if (incomplete.length > 0) {
    await resumeIncompletePartitions(queues.generatePartition, incomplete);
  }
}

/** Boot reconciliation (R5, contracts/api.md invariant 4): a stream reported as `streaming` or
 * `paused` must have a BullMQ job for its current session. If that job is *missing* (Redis lost
 * it), the stream is moved to `stopped` so the UI doesn't show a stream that is not running.
 * A merely *stalled* job is left alone — BullMQ re-runs it in the same session. */
async function reconcileStreams(): Promise<void> {
  for (const stream of await streams.listByState(["streaming", "paused"])) {
    const session = stream.current_session_id
      ? await streamSessions.getById(stream.current_session_id)
      : undefined;
    const job = session
      ? await queues.streamDrive.getJob(`stream-${stream.run_id}-${session.seq}`)
      : undefined;
    if (job) continue;
    await streams.setState(stream.id, "stopped");
    await streams.setLastError(stream.id, "session job lost; start the stream again");
    if (session) await streamSessions.end(session.id, "session job lost");
  }
}

/** A replay that was pending or running must have a live `deliver` job. If Redis lost it, the
 * job is queued again; it continues from the saved cursor, so nothing is re-sent. */
async function reconcileDeliveries(): Promise<void> {
  const deliveries = new RunDeliveryRepository(db);
  for (const run of await runs.listByStatus("completed")) {
    if (!run.replay_history) continue;
    for (const delivery of await deliveries.listByRun(run.id)) {
      if (delivery.state !== "pending" && delivery.state !== "running") continue;
      const jobs = await queues.deliver.getJobs(["waiting", "active", "delayed", "prioritized"]);
      const hasJob = jobs.some(
        (job) => job.data.runId === run.id && job.data.sinkName === delivery.sink_name,
      );
      if (hasJob) continue;
      const payload = await deliverPayloadFor(db, run, delivery.sink_name, dataDir);
      if (payload) await enqueueDelivery(payload, Date.now());
    }
  }
}

await resumeAfterRestart();
await reconcileStreams();
await reconcileDeliveries();
console.log(
  "txloom worker: generate-partition, stream-drive, deliver, export-build, report-build, connection-test consumers running",
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`txloom worker: received ${signal}, shutting down`);
  await Promise.all([
    generatePartitionWorker.close(),
    streamDriveWorker.close(),
    deliverWorker.close(),
    exportBuildWorker.close(),
    reportBuildWorker.close(),
    connectionTestWorker.close(),
  ]);
  await closePartitionPool();
  await closeQueues();
  await closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
