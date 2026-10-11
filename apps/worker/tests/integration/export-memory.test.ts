import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LABEL_RECORD_SCHEMA, TRUTH_EVENT_SCHEMA, writeParquet } from "@txloom/sinks";
import { buildExport } from "../../src/jobs/export-build.js";

const EVENTS = 2_000_000;

function* truthRows() {
  for (let i = 0; i < EVENTS; i++) {
    yield {
      event_id: `e${i}`,
      ts: "2026-01-01T10:00:00.000Z",
      type: "payment",
      status: "approved",
      amount: 10,
      currency: "INR",
      consumer_id: `c${i % 1000}`,
      consumer_name: "Asha",
      merchant_id: "m1",
      merchant_name: "Shop",
      counterparty_id: null,
      counterparty_name: null,
      channel: "upi",
      partition_no: 0,
    };
  }
}

function* labelRows() {
  for (let i = 0; i < EVENTS; i++) {
    const fraud = i % 50 === 0;
    yield {
      event_id: `e${i}`,
      is_fraud: fraud,
      typology: fraud ? "card_testing" : null,
      actor_id: fraud ? `actor_${i}` : null,
      campaign_step: fraud ? 0 : null,
      corruption_type: null,
      corruption_detail: null,
      sink: null,
      delivery_outcome: null,
    };
  }
}

// Building a merged export of a 2M-event run streams both files in lockstep, so the worker's
// memory does not grow with the run (FR-025, constitution Principle V).
describe("export build memory", () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-export-mem-"));
    const runDir = path.join(dataDir, "runs", "big-run");
    await writeParquet(
      path.join(runDir, "truth", "part-0.parquet"),
      TRUTH_EVENT_SCHEMA,
      truthRows(),
    );
    await writeParquet(
      path.join(runDir, "labels", "part-0.parquet"),
      LABEL_RECORD_SCHEMA,
      labelRows(),
    );
  }, 300_000);

  afterAll(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("keeps RSS growth under 100 MB", async () => {
    (globalThis as { gc?: () => void }).gc?.();
    const before = process.memoryUsage().rss;
    let peak = before;
    const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 100);
    try {
      await buildExport(
        {
          export_id: "x1",
          run_id: "big-run",
          format: "csv",
          include_labels: true,
          source: { kind: "truth" },
          status: "running",
          created_at: new Date().toISOString(),
          file_name: "data.csv",
          answer_key_file_name: null,
        },
        dataDir,
      );
    } finally {
      clearInterval(sampler);
    }
    const file = path.join(dataDir, "runs", "big-run", "exports", "x1", "data.csv");
    expect((await stat(file)).size).toBeGreaterThan(100_000_000);
    expect((peak - before) / (1024 * 1024)).toBeLessThan(100);
  }, 600_000);
});
