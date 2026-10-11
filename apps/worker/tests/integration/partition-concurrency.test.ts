import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Worker } from "bullmq";
import { getDb } from "../../../api/src/db/knex.js";
import { getQueues } from "../../../api/src/services/queues.js";
import { createGeneratePartitionCallbacks } from "../../src/handlers.js";
import { startGeneratePartitionWorker } from "../../src/jobs/generate-partition.js";
import { closePartitionPool } from "../../src/pool/piscina-pool.js";
import {
  launchSpec,
  queueConnection,
  startStack,
  waitFor,
  type TestStack,
} from "../support/stack.js";
import { tinySpec } from "../../../api/tests/support/tiny-spec.js";

// Real BullMQ worker over the real Piscina pool. Run via `pnpm test:integration`.
describe("partition concurrency (R4, SC-006)", () => {
  let stack: TestStack;
  let worker: Worker;

  beforeAll(async () => {
    process.env.TXLOOM_MAX_WORKER_THREADS = "4";
    process.env.TXLOOM_PARTITION_CHUNK_SIZE = "2000";
    stack = await startStack();
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await closePartitionPool();
    await stack?.stop();
    delete process.env.TXLOOM_MAX_WORKER_THREADS;
    delete process.env.TXLOOM_PARTITION_CHUNK_SIZE;
  });

  it("runs at least two of a four-partition run's partitions at the same time", async () => {
    const callbacks = createGeneratePartitionCallbacks({
      db: getDb(),
      queues: getQueues(),
      dataDir: stack.dataDir,
    });
    worker = startGeneratePartitionWorker({ connection: queueConnection(), ...callbacks });

    const runId = await launchSpec(
      stack.app,
      tinySpec({ consumers: 8000, days: 10 }),
      "concurrency",
    );
    const partitions = await getDb()("run_partitions").where({ run_id: runId });
    expect(partitions).toHaveLength(4);

    let maxRunning = 0;
    await waitFor(
      async () => {
        const rows = await getDb()("run_partitions").where({ run_id: runId });
        maxRunning = Math.max(maxRunning, rows.filter((r) => r.state === "running").length);
        return rows.every((r) => r.state === "done");
      },
      120_000,
      25,
    );

    expect(maxRunning).toBeGreaterThanOrEqual(2);
    // The run flips to completed just after its last partition is marked done.
    await waitFor(
      async () => (await getDb()("runs").where({ id: runId }).first()).status === "completed",
      10_000,
      25,
    );
  }, 180_000);
});
