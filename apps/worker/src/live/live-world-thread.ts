import { parentPort, workerData } from "node:worker_threads";
import { openLiveWorld, type LiveWorld } from "@txloom/engine";
import { writeLiveDayCheckpoint } from "./live-checkpoints.js";
import { getMerchants } from "../pool/merchant-cache.js";
import type { LiveChunk, LiveSourceInit } from "./live-source.js";

// The worker-thread side of `ThreadedLiveSource`: owns the live world and answers `more`
// requests with the next chunk. The request/response protocol is one chunk at a time, so the
// consumer decides how far ahead to buffer.
if (!parentPort) throw new Error("live-world-thread must run in a worker thread");
const port = parentPort;

let world: LiveWorld;
let announcedDay = -1;
let target: LiveSourceInit["checkpointTarget"];
let runId = "";

try {
  const init = workerData as LiveSourceInit;
  target = init.checkpointTarget;
  runId = init.runId;
  const seed = BigInt(init.seed);
  const merchants = getMerchants(init.runId, init.engineVersion, init.spec, seed);
  world = openLiveWorld(init.spec, seed, init.checkpoints, merchants, init.sinks, {
    skipFirstDay: init.skipFirstDay,
  });
  port.postMessage({ type: "ready" });
} catch (error) {
  port.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

port.on("message", async (message: { type: "more"; id: number; maxEvents: number }) => {
  try {
    const batch = world.nextBatch(message.maxEvents);
    const chunk: LiveChunk = {
      ...batch,
      length: Math.max(0, ...Object.values(batch.bySink).map((list) => list.length)),
    };
    if (batch.dayIndex !== announcedDay) {
      announcedDay = batch.dayIndex;
      const checkpoint = world.dayCheckpoint();
      if (checkpoint && target) {
        // Written here: encoding a whole world would stall the thread that paces deliveries.
        await writeLiveDayCheckpoint(target.dataDir, runId, target.sessionId, checkpoint, {
          prune: false,
        });
        chunk.checkpointWrittenDay = checkpoint.dayIndex;
      } else if (checkpoint) {
        chunk.dayCheckpoint = checkpoint;
      }
    }
    port.postMessage({ type: "chunk", id: message.id, chunk });
  } catch (error) {
    port.postMessage({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
