import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Worker } from "bullmq";
import { getDb } from "../../../api/src/db/knex.js";
import { getQueues } from "../../../api/src/services/queues.js";
import { createGeneratePartitionCallbacks } from "../../src/handlers.js";
import {
  startGeneratePartitionWorker,
  type GeneratePartitionDeps,
} from "../../src/jobs/generate-partition.js";
import { closePartitionPool } from "../../src/pool/piscina-pool.js";
import {
  launchSpec,
  queueConnection,
  startStack,
  waitFor,
  type TestStack,
} from "../support/stack.js";
import { tinySpec } from "../../../api/tests/support/tiny-spec.js";

// Run lifecycle through the real worker callbacks (R13). Run via `pnpm test:integration`.
describe("run lifecycle", () => {
  let stack: TestStack;
  let worker: Worker | undefined;

  beforeAll(async () => {
    stack = await startStack();
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await closePartitionPool();
    await stack?.stop();
  });

  function startWorker(extra: Partial<GeneratePartitionDeps> = {}) {
    const callbacks = createGeneratePartitionCallbacks({
      db: getDb(),
      queues: getQueues(),
      dataDir: stack.dataDir,
    });
    worker = startGeneratePartitionWorker({
      connection: queueConnection(),
      ...callbacks,
      ...extra,
    });
  }

  async function stopWorker() {
    await worker?.close();
    worker = undefined;
    await getQueues().generatePartition.obliterate({ force: true });
  }

  const runRow = (runId: string) => getDb()("runs").where({ id: runId }).first();
  const partitionRow = (runId: string) =>
    getDb()("run_partitions").where({ run_id: runId, partition_no: 0 }).first();

  it("a one-consumer, one-day run completes and records its end-of-history checkpoint", async () => {
    startWorker();
    const runId = await launchSpec(stack.app, tinySpec({ consumers: 1, days: 1 }), "tiny");
    expect((await runRow(runId)).status).toBe("running");

    await waitFor(async () => (await runRow(runId)).status === "completed", 60_000);

    const partition = await partitionRow(runId);
    const ref =
      typeof partition.rng_checkpoint === "string"
        ? JSON.parse(partition.rng_checkpoint)
        : partition.rng_checkpoint;
    expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ref.next_day_index).toBe(1);
    expect(existsSync(ref.path)).toBe(true);
    await stopWorker();
  }, 120_000);

  it("records the measured generation throughput from a completed partition", async () => {
    await getDb()("settings").where({ key: "generation_throughput" }).delete();
    startWorker();
    const runId = await launchSpec(stack.app, tinySpec({ consumers: 20, days: 3 }), "throughput");
    await waitFor(async () => (await runRow(runId)).status === "completed", 60_000);

    const setting = await getDb()("settings").where({ key: "generation_throughput" }).first();
    const events = Number((await partitionRow(runId)).events_generated);
    expect(events).toBeGreaterThan(0);
    // Events per second for the one thread that ran it: positive, and finite.
    expect(Number(setting.value)).toBeGreaterThan(0);
    expect(Number.isFinite(Number(setting.value))).toBe(true);
    await stopWorker();
  }, 120_000);

  it("a partition that throws once and then succeeds completes with attempts = 2", async () => {
    let calls = 0;
    const { default: realRun } = await import("../../src/pool/partition-worker.js");
    startWorker({
      runPartition: async (input) => {
        if (++calls === 1) throw new Error("transient failure");
        return realRun(input);
      },
    });
    const runId = await launchSpec(stack.app, tinySpec({ consumers: 1, days: 1 }), "flaky");

    await waitFor(async () => (await runRow(runId)).status === "completed", 60_000);
    expect((await partitionRow(runId)).attempts).toBe(2);
    expect((await partitionRow(runId)).state).toBe("done");
    await stopWorker();
  }, 120_000);

  it("a partition that always throws fails the run after 3 attempts, with last_error set", async () => {
    let calls = 0;
    startWorker({
      runPartition: async () => {
        calls++;
        throw new Error("permanent failure");
      },
    });
    const runId = await launchSpec(stack.app, tinySpec({ consumers: 1, days: 1 }), "doomed");

    await waitFor(async () => (await runRow(runId)).status === "failed", 90_000);
    expect(calls).toBe(3);
    const partition = await partitionRow(runId);
    expect(partition.state).toBe("failed");
    expect(partition.attempts).toBe(3);
    expect(partition.last_error).toBe("permanent failure");
    expect((await runRow(runId)).error).toBe("permanent failure");
    await stopWorker();
  }, 120_000);
});
