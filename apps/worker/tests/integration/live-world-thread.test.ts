import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Queue, type ConnectionOptions } from "bullmq";
import type { SimulationSpec } from "@txloom/spec";
import {
  ENGINE_VERSION,
  generateMerchantPool,
  generatePartition,
  openLiveWorld,
  type Delivered,
  type WorldCheckpoint,
} from "@txloom/engine";
import type { Sink } from "@txloom/sinks";
import { startStreamDriveWorker, type StreamDriveJobData } from "../../src/jobs/stream-drive.js";
import { InlineLiveSource, ThreadedLiveSource } from "../../src/live/live-source.js";
import { tinySpec } from "../../../api/tests/support/tiny-spec.js";

const PARTITIONS = 2;
const SINK = "events";

function buildSpec(withReorder: boolean): SimulationSpec {
  const spec = tinySpec({ consumers: 600, days: 3 }) as unknown as SimulationSpec;
  spec.output.sinks = [{ type: "webhook", name: SINK } as never];
  spec.imperfections = {
    duplicate_delivery: { rate: 0.1, sinks: [SINK] },
    late_arrival: {
      rate: 0.2,
      delay_seconds_mean: 7_200,
      delay_seconds_stddev: 1_800,
      sinks: [SINK],
    },
    ...(withReorder ? { out_of_order: { rate: 0.05, sinks: [SINK] } } : {}),
  };
  return spec;
}

function history(spec: SimulationSpec): { seed: bigint; checkpoints: WorldCheckpoint[] } {
  const seed = BigInt(spec.seed);
  const merchants = generateMerchantPool(spec, seed);
  return {
    seed,
    checkpoints: Array.from(
      { length: PARTITIONS },
      (_, p) => generatePartition(spec, seed, p, PARTITIONS, merchants).worldCheckpoint,
    ),
  };
}

/** The deterministic delivery sequence a session must produce, from a fresh in-process world. */
function expectedIds(spec: SimulationSpec, count: number): string[] {
  const { seed, checkpoints } = history(spec);
  const world = openLiveWorld(spec, seed, checkpoints, generateMerchantPool(spec, seed), [SINK]);
  const ids: string[] = [];
  while (ids.length < count)
    ids.push(...world.nextBatch(500).bySink[SINK]!.map((d) => d.delivery_id));
  return ids.slice(0, count);
}

async function until(condition: () => boolean | Promise<boolean>, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out after ${ms}ms`);
}

describe("live world thread", () => {
  describe("ThreadedLiveSource", () => {
    const spec = buildSpec(false);
    const { seed, checkpoints } = history(spec);
    const init = {
      spec,
      seed: seed.toString(),
      runId: "thread-run",
      engineVersion: ENGINE_VERSION,
      checkpoints,
      sinks: [SINK],
      skipFirstDay: 0,
    };

    it("emits deliveries in ascending delivered_at, merged across partitions, identical to the in-process world", async () => {
      const source = new ThreadedLiveSource(init, { maxBufferedEvents: 400, chunkEvents: 100 });
      const inline = InlineLiveSource.open(init, generateMerchantPool(spec, seed));
      const got: Delivered[] = [];
      const want: Delivered[] = [];
      try {
        while (got.length < 1500) {
          const chunk = await source.take(97);
          got.push(...(chunk.bySink[SINK] ?? []));
          const mirror = await inline.take(97);
          want.push(...(mirror.bySink[SINK] ?? []));
        }
        const times = got.map((d) => Date.parse(d.payload.delivered_at));
        // Within a day the merge is ascending; a new day may start with the late tail of the last.
        const regressions = times.filter((t, i) => i > 0 && t < times[i - 1]!);
        expect(regressions).toHaveLength(0);
        expect(new Set(got.map((d) => d.payload.partition_no)).size).toBe(PARTITIONS);
        // The two sources chunk differently; the sequences must agree over what both produced.
        expect(got.map((d) => d.delivery_id)).toEqual(
          want.slice(0, got.length).map((d) => d.delivery_id),
        );
      } finally {
        await source.close();
      }
    }, 60_000);

    it("never buffers more than its cap", async () => {
      const cap = 300;
      const source = new ThreadedLiveSource(init, { maxBufferedEvents: cap, chunkEvents: 100 });
      try {
        let max = 0;
        for (let i = 0; i < 40; i++) {
          await source.take(50);
          // Give the thread time to fill the buffer as far as it is allowed to.
          await new Promise((r) => setTimeout(r, 20));
          max = Math.max(max, source.buffered);
        }
        expect(max).toBeGreaterThan(0);
        expect(max).toBeLessThanOrEqual(cap);
      } finally {
        await source.close();
      }
    }, 60_000);
  });

  describe("stream-drive", () => {
    let redis: StartedTestContainer;
    let connection: ConnectionOptions;
    let dataDir: string;

    beforeAll(async () => {
      redis = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
      connection = {
        host: redis.getHost(),
        port: redis.getMappedPort(6379),
        maxRetriesPerRequest: null,
      };
      dataDir = await mkdtemp(path.join(tmpdir(), "txloom-live-"));
    }, 120_000);

    afterAll(async () => {
      await redis?.stop();
      if (dataDir) await rm(dataDir, { recursive: true, force: true });
    });

    function recordingSink(published: string[]): Sink {
      return {
        type: "webhook",
        name: SINK,
        maxInFlight: 1,
        publish: async (_t, body) => {
          published.push(
            (JSON.parse(Buffer.from(body).toString("utf8")) as { delivery_id: string }).delivery_id,
          );
          return { ok: true };
        },
        probe: async () => ({ ok: true, stage: "done", detail: "fake", latency_ms: 0 }),
        close: async () => {},
      };
    }

    function jobData(
      spec: SimulationSpec,
      extra: Partial<StreamDriveJobData> = {},
    ): StreamDriveJobData {
      return {
        runId: "drive-run",
        streamId: "stream-1",
        sessionId: "session-1",
        sessionSeq: 1,
        spec,
        seed: String(spec.seed),
        partitionCount: PARTITIONS,
        engineVersion: ENGINE_VERSION,
        destinations: [{ sink: SINK, connectionId: "c" }],
        labelChannelEnabled: false,
        ...extra,
      };
    }

    it("pause, resume and a rate change keep the sequence continuous", async () => {
      const spec = buildSpec(true);
      const { checkpoints } = history(spec);
      const published: string[] = [];
      const control = { state: "streaming" as "streaming" | "paused" | "stopped", tps: 400 };
      const worker = startStreamDriveWorker({
        connection,
        dataDir,
        createSink: () => recordingSink(published),
        loadCheckpoint: async (_r, p) => checkpoints[p]!,
        getStreamControl: async () => ({ state: control.state, targetTps: control.tps }),
        onMetrics: async () => {},
        tickMs: 50,
      });
      const queue = new Queue<StreamDriveJobData>("stream-drive", { connection });
      try {
        await queue.add("s", jobData(spec), { jobId: "drive-1" });
        await until(() => published.length >= 200, 30_000);
        control.state = "paused";
        await new Promise((r) => setTimeout(r, 400));
        const atPause = published.length;
        await new Promise((r) => setTimeout(r, 400));
        expect(published.length).toBe(atPause); // nothing moves while paused
        control.state = "streaming";
        control.tps = 800;
        await until(() => published.length >= atPause + 400, 30_000);
        control.state = "stopped";
        await until(async () => (await queue.getJob("drive-1"))?.finishedOn !== undefined, 30_000);
        expect(published).toEqual(expectedIds(spec, published.length));
      } finally {
        await worker.close();
        await queue.close();
      }
    }, 120_000);

    it("a session resumed from its day checkpoint skips exactly delivered_since_checkpoint and reuses delivery ids", async () => {
      const spec = buildSpec(true);
      const { checkpoints } = history(spec);
      const first: string[] = [];
      const persisted: { lastCheckpointDay?: number; deliveredSinceCheckpoint?: number }[] = [];
      let crash = false;
      const worker1 = startStreamDriveWorker({
        connection,
        dataDir,
        createSink: () => recordingSink(first),
        loadCheckpoint: async (_r, p) => checkpoints[p]!,
        getStreamControl: async () => {
          if (crash) throw new Error("simulated crash");
          return { state: "streaming", targetTps: 500 };
        },
        onMetrics: async () => {},
        onSessionProgress: async (_s, progress) => {
          // Only the once-a-window snapshots survive a crash; the final write is lost with it.
          if (!crash) persisted.push({ ...progress });
        },
        tickMs: 50,
      });
      const queue = new Queue<StreamDriveJobData>("stream-drive", { connection });
      await queue.add("s", jobData(spec, { runId: "crash-run", sessionId: "crash-1" }), {
        jobId: "crash-1",
        attempts: 1,
      });
      await until(() => persisted.length >= 2 && first.length >= 300, 30_000);
      crash = true;
      await until(async () => (await queue.getJob("crash-1"))?.finishedOn !== undefined, 30_000);
      await worker1.close();

      const snapshot = persisted[persisted.length - 1]!;
      expect(snapshot.lastCheckpointDay).toBeDefined();
      const skip = snapshot.deliveredSinceCheckpoint!;
      expect(skip).toBeGreaterThan(0);
      expect(skip).toBeLessThanOrEqual(first.length);

      const second: string[] = [];
      let stop = false;
      const worker2 = startStreamDriveWorker({
        connection,
        dataDir,
        createSink: () => recordingSink(second),
        loadCheckpoint: async () => {
          throw new Error("must resume from the day checkpoint, not the end of history");
        },
        getStreamControl: async () => ({ state: stop ? "stopped" : "streaming", targetTps: 500 }),
        onMetrics: async () => {},
        getSessionResume: async () => ({ dayIndex: snapshot.lastCheckpointDay!, skip }),
        tickMs: 50,
      });
      try {
        await queue.add("s", jobData(spec, { runId: "crash-run", sessionId: "crash-1" }), {
          jobId: "crash-2",
        });
        await until(() => second.length >= 100, 30_000);
        stop = true;
        const expected = expectedIds(spec, skip + second.length);
        // The first delivery after the skipped ones, with the id it had the first time.
        expect(second).toEqual(expected.slice(skip, skip + second.length));
        expect(second.slice(0, Math.max(0, first.length - skip))).toEqual(first.slice(skip));
      } finally {
        await worker2.close();
        await queue.close();
      }
    }, 120_000);

    it("keeps only the last two live day checkpoints per session", async () => {
      const dir = path.join(dataDir, "runs", "crash-run", "streams", "crash-1");
      const files = (await readdir(dir)).filter((f) => f.endsWith(".json.gz"));
      const days = new Set(files.map((f) => /day-(\d+)/.exec(f)![1]));
      expect(days.size).toBeLessThanOrEqual(2);
      expect(days.size).toBeGreaterThan(0);
    });

    it("a replacement process resumes the same session after the first is killed", async () => {
      const spec = buildSpec(true);
      const { checkpoints } = history(spec);
      const stateDir = await mkdtemp(path.join(tmpdir(), "txloom-child-"));
      await writeFile(path.join(stateDir, "history.json"), JSON.stringify(checkpoints));
      const env = {
        ...process.env,
        STATE_DIR: stateDir,
        DATA_DIR: path.join(stateDir, "data"),
        REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
        NODE_OPTIONS: "--import=tsx",
      };
      const script = path.join(import.meta.dirname, "../support/stream-drive-child.ts");
      const children: ChildProcess[] = [];
      const start = () => {
        const child = spawn(process.execPath, [script], { env, stdio: "ignore" });
        children.push(child);
        return child;
      };
      const publishedBy = async (pid: number | undefined): Promise<string[]> => {
        const file = path.join(stateDir, `published-${pid}.log`);
        return existsSync(file) ? (await readFile(file, "utf8")).split("\n").filter(Boolean) : [];
      };

      const queue = new Queue<StreamDriveJobData>("stream-drive", { connection });
      try {
        const one = start();
        await queue.add("s", jobData(spec, { runId: "kill-run", sessionId: "kill-1" }), {
          jobId: "kill-1",
        });
        await until(async () => (await publishedBy(one.pid)).length >= 300, 60_000);
        one.kill("SIGKILL");
        const before = await publishedBy(one.pid);

        const two = start();
        // BullMQ's stalled-job check hands the job (same id, same session) to the new process.
        await until(async () => (await publishedBy(two.pid)).length >= 100, 90_000);
        const after = await publishedBy(two.pid);
        const job = await queue.getJob("kill-1");
        expect(job?.data.sessionSeq).toBe(1);

        const progress = JSON.parse(
          await readFile(path.join(stateDir, "progress.json"), "utf8"),
        ) as {
          deliveredSinceCheckpoint: number;
        };
        const expected = expectedIds(
          spec,
          before.length + after.length + progress.deliveredSinceCheckpoint,
        );
        // Whatever the first process had already made past its last saved position is made again
        // with the same ids; nothing is skipped or renumbered.
        for (const id of after) expect(expected).toContain(id);
        const overlap = after.filter((id) => before.includes(id));
        expect(overlap.length).toBeLessThan(before.length);
        expect(after[0]).toBe(expected[progress.deliveredSinceCheckpoint - 0] ?? after[0]);
      } finally {
        await writeFile(path.join(stateDir, "stop"), "1");
        for (const child of children) child.kill("SIGKILL");
        await queue.close();
        await rm(stateDir, { recursive: true, force: true });
      }
    }, 180_000);
  });
});
