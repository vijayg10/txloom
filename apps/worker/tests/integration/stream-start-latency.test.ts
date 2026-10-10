import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Queue, type ConnectionOptions } from "bullmq";
import type { SimulationSpec } from "@txloom/spec";
import { generateMerchantPool, generatePartition, type WorldCheckpoint } from "@txloom/engine";
import type { Sink } from "@txloom/sinks";
import { startStreamDriveWorker, type StreamDriveJobData } from "../../src/jobs/stream-drive.js";
import { tinySpec } from "../../../api/tests/support/tiny-spec.js";

// Counts every call to the day simulator, wherever it is imported from.
const simulateDaySpy = vi.hoisted(() => vi.fn());
vi.mock("../../../../packages/engine/src/world/simulate-day.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../../packages/engine/src/world/simulate-day.js")>();
  return {
    ...original,
    simulateDay: (...args: Parameters<typeof original.simulateDay>) => {
      simulateDaySpy(...args);
      return original.simulateDay(...args);
    },
  };
});

const PARTITIONS = 10;

describe("stream start latency (R7, SC-011)", () => {
  let redis: StartedTestContainer;
  let connection: ConnectionOptions;

  beforeAll(async () => {
    redis = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    connection = {
      host: redis.getHost(),
      port: redis.getMappedPort(6379),
      maxRetriesPerRequest: null,
    };
  }, 120_000);

  afterAll(async () => {
    await redis?.stop();
  });

  it("loads checkpoints instead of replaying history, and publishes the first event within 30 s", async () => {
    const spec = tinySpec({ consumers: PARTITIONS, days: 30 }) as unknown as SimulationSpec;
    const seed = BigInt(spec.seed);
    const merchants = generateMerchantPool(spec, seed);
    const checkpoints: WorldCheckpoint[] = Array.from(
      { length: PARTITIONS },
      (_, partitionNo) =>
        generatePartition(spec, seed, partitionNo, PARTITIONS, merchants).worldCheckpoint,
    );
    expect(simulateDaySpy).toHaveBeenCalled(); // building the fixtures did simulate history…
    simulateDaySpy.mockClear(); // …starting the stream must not.

    let firstEventAt: number | null = null;
    let stop = false;
    const sink: Sink = {
      type: "webhook",
      name: "fake",
      maxInFlight: 8,
      publish: async () => {
        firstEventAt ??= Date.now();
        stop = true;
        return { ok: true };
      },
      probe: async () => ({ ok: true, stage: "done", detail: "fake", latency_ms: 0 }),
      close: async () => {},
    };
    const worker = startStreamDriveWorker({
      connection,
      createSink: () => sink,
      loadCheckpoint: async (_runId, partitionNo) => checkpoints[partitionNo]!,
      getStreamControl: async () => ({ state: stop ? "stopped" : "streaming", targetTps: 100 }),
      onMetrics: async () => {},
      tickMs: 50,
    });
    const queue = new Queue<StreamDriveJobData>("stream-drive", { connection });
    const startedAt = Date.now();
    await queue.add("stream", {
      runId: "latency-run",
      streamId: "latency-stream",
      sessionId: "latency-session",
      sessionSeq: 1,
      spec,
      seed: seed.toString(),
      partitionCount: PARTITIONS,
      engineVersion: (await import("@txloom/engine")).ENGINE_VERSION,
      destinations: [{ sink: "live", connectionId: "unused" }],
      labelChannelEnabled: false,
    });

    const deadline = Date.now() + 30_000;
    while (firstEventAt === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await worker.close();
    await queue.close();

    expect(firstEventAt).not.toBeNull();
    expect(firstEventAt! - startedAt).toBeLessThan(30_000);
    expect(simulateDaySpy).not.toHaveBeenCalled();
  }, 90_000);
});
