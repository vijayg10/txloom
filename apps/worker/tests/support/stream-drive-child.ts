// A stream-drive worker in its own OS process, for the kill-and-resume test. State a database
// would hold lives in a JSON file in STATE_DIR so a replacement process sees the same session.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorldCheckpoint } from "@txloom/engine";
import type { Sink } from "@txloom/sinks";
import { startStreamDriveWorker } from "../../src/jobs/stream-drive.js";

const stateDir = process.env.STATE_DIR!;
const dataDir = process.env.DATA_DIR!;
const redis = new URL(process.env.REDIS_URL!);
const checkpoints = JSON.parse(
  readFileSync(path.join(stateDir, "history.json"), "utf8"),
) as WorldCheckpoint[];
const progressFile = path.join(stateDir, "progress.json");

const sink: Sink = {
  type: "webhook",
  name: "events",
  maxInFlight: 1,
  publish: async (_target, body) => {
    const payload = JSON.parse(Buffer.from(body).toString("utf8")) as { delivery_id: string };
    appendFileSync(path.join(stateDir, `published-${process.pid}.log`), payload.delivery_id + "\n");
    return { ok: true };
  },
  probe: async () => ({ ok: true, stage: "done", detail: "fake", latency_ms: 0 }),
  close: async () => {},
};

startStreamDriveWorker({
  connection: { host: redis.hostname, port: Number(redis.port), maxRetriesPerRequest: null },
  dataDir,
  createSink: () => sink,
  loadCheckpoint: async (_runId, partitionNo) => checkpoints[partitionNo]!,
  getStreamControl: async () => ({
    state: existsSync(path.join(stateDir, "stop")) ? "stopped" : "streaming",
    targetTps: 300,
  }),
  onMetrics: async () => {},
  onSessionProgress: async (_sessionId, progress) => {
    writeFileSync(progressFile, JSON.stringify(progress));
  },
  getSessionResume: async () => {
    if (!existsSync(progressFile)) return null;
    const progress = JSON.parse(readFileSync(progressFile, "utf8")) as {
      lastCheckpointDay?: number;
      deliveredSinceCheckpoint?: number;
    };
    return progress.lastCheckpointDay === undefined
      ? null
      : { dayIndex: progress.lastCheckpointDay, skip: progress.deliveredSinceCheckpoint ?? 0 };
  },
  tickMs: 50,
  lockDurationMs: 4000,
  stalledIntervalMs: 2000,
});
console.log("child ready");
