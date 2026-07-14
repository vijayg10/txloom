import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Queue, type ConnectionOptions } from "bullmq";
import type { SimulationSpec } from "@txloom/spec";
import { generateMerchantPool } from "@txloom/engine";
import { readParquet } from "@txloom/sinks";
import {
  startGeneratePartitionWorker,
  type GeneratePartitionJobData,
} from "../../src/jobs/generate-partition.js";

const spec: SimulationSpec = {
  seed: 7,
  currency: "INR",
  locale: "en-IN",
  channel: "upi",
  clock: { start: "2026-01-01", days: 10 },
  population: {
    consumers: {
      count: 30,
      archetypes: [
        {
          name: "salaried",
          weight: 1,
          income_pattern: {
            kind: "fixed_credit_day",
            day_of_month: 1,
            amount_mean: 50000,
            amount_stddev: 5000,
          },
          spend_rhythm: {
            daily_transaction_count_mean: 2,
            daily_transaction_count_stddev: 1,
            weekend_multiplier: 1.2,
          },
        },
      ],
    },
    merchants: {
      count: 5,
      categories: {
        grocery: {
          name: "grocery",
          weight: 1,
          amount_distribution: { kind: "lognormal", mean: 500, stddev: 100 },
        },
      },
    },
  },
  seasonality: [],
  fraud: {
    target_rate: 0.05,
    typologies: [
      {
        type: "card_testing",
        share: 1,
        params: {
          burst_size_min: 3,
          burst_size_max: 5,
          burst_window_minutes: 5,
          amount_min: 1,
          amount_max: 20,
        },
      },
    ],
  },
  outcomes: { baseline_decline_rate: 0.02 },
  imperfections: { duplicate_delivery: { rate: 0.05, sinks: ["primary"] } },
  output: { sinks: [{ type: "file", name: "primary", format: "csv" }], labels: "separate_export" },
};

// Testcontainers Redis — full generate → file-write → label-reconciliation
// loop through the real BullMQ generate-partition worker (not just the pure
// engine functions). Run via `pnpm test:integration`.
describe("generate-partition worker: full loop", () => {
  let redis: StartedTestContainer;
  let connection: ConnectionOptions;
  let dataDir: string;
  const runId = "test-run-001";

  beforeAll(async () => {
    redis = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    connection = {
      host: redis.getHost(),
      port: redis.getMappedPort(6379),
      maxRetriesPerRequest: null,
    };
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-run-"));
  }, 120_000);

  afterAll(async () => {
    await redis?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  async function runPartitionJob(seed: bigint): Promise<void> {
    const queue = new Queue<GeneratePartitionJobData>("generate-partition", { connection });
    const merchants = generateMerchantPool(spec, seed);

    const done = new Promise<void>((resolve, reject) => {
      const worker = startGeneratePartitionWorker({
        connection,
        onPartitionRunning: async () => {},
        onPartitionDone: async () => {
          await worker.close();
          resolve();
        },
        onPartitionFailed: async (_data, error) => {
          await worker.close();
          reject(error);
        },
      });
    });

    await queue.add("gen", {
      runId,
      spec,
      seed: seed.toString(),
      partitionNo: 0,
      partitionCount: 1,
      merchants,
      dataDir,
    });
    await done;
    await queue.close();
  }

  it("generates truth + labels + delivered files whose labels reconcile with the data", async () => {
    await runPartitionJob(BigInt(spec.seed));

    const truthDir = path.join(dataDir, "runs", runId, "truth");
    const labelsDir = path.join(dataDir, "runs", runId, "labels");
    const deliveredDir = path.join(dataDir, "runs", runId, "delivered", "primary");

    const truthFiles = await readdir(truthDir);
    expect(truthFiles).toContain("part-0.parquet");

    const truthEvents: Record<string, unknown>[] = [];
    for await (const row of readParquet(path.join(truthDir, "part-0.parquet")))
      truthEvents.push(row);
    expect(truthEvents.length).toBeGreaterThan(0);

    const labels: Record<string, unknown>[] = [];
    for await (const row of readParquet(path.join(labelsDir, "part-0.parquet"))) labels.push(row);

    const truthIds = new Set(truthEvents.map((e) => e.event_id));
    for (const label of labels) {
      expect(truthIds.has(label.event_id)).toBe(true);
    }

    const fraudLabels = labels.filter((l) => l.is_fraud);
    const achievedRate = fraudLabels.length / truthEvents.length;
    expect(Math.abs(achievedRate - spec.fraud.target_rate)).toBeLessThan(0.05);

    const duplicateLabels = labels.filter((l) => l.corruption_type === "duplicate");
    expect(duplicateLabels.length).toBeGreaterThan(0);

    const deliveredFiles = await readdir(deliveredDir);
    expect(deliveredFiles).toContain("part-0.parquet");
    const delivered: Record<string, unknown>[] = [];
    for await (const row of readParquet(path.join(deliveredDir, "part-0.parquet")))
      delivered.push(row);
    expect(delivered.length).toBeGreaterThanOrEqual(truthEvents.length);
  }, 60_000);

  it("a second run with the same seed/spec is byte-identical (SC-001)", async () => {
    const secondRunId = "test-run-002";
    const queue = new Queue<GeneratePartitionJobData>("generate-partition", { connection });
    const merchants = generateMerchantPool(spec, BigInt(spec.seed));

    const done = new Promise<void>((resolve, reject) => {
      const worker = startGeneratePartitionWorker({
        connection,
        onPartitionRunning: async () => {},
        onPartitionDone: async () => {
          await worker.close();
          resolve();
        },
        onPartitionFailed: async (_data, error) => {
          await worker.close();
          reject(error);
        },
      });
    });
    await queue.add("gen2", {
      runId: secondRunId,
      spec,
      seed: spec.seed.toString(),
      partitionNo: 0,
      partitionCount: 1,
      merchants,
      dataDir,
    });
    await done;
    await queue.close();

    async function readAll(runId2: string): Promise<Record<string, unknown>[]> {
      const rows: Record<string, unknown>[] = [];
      for await (const row of readParquet(
        path.join(dataDir, "runs", runId2, "truth", "part-0.parquet"),
      ))
        rows.push(row);
      return rows;
    }

    const first = await readAll(runId);
    const second = await readAll(secondRunId);
    expect(second).toEqual(first);
  }, 60_000);
});
