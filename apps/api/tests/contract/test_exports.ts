import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import {
  DELIVERED_EVENT_SCHEMA,
  LABEL_RECORD_SCHEMA,
  TRUTH_EVENT_SCHEMA,
  writeParquet,
} from "@txloom/sinks";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/knex.js";
import { closeQueues, getQueues } from "../../src/services/queues.js";
import { RunRepository } from "../../src/db/repositories/runs.js";
import { ScenarioRepository } from "../../src/db/repositories/scenarios.js";
import { SpecVersionRepository } from "../../src/db/repositories/spec-versions.js";
import {
  startExportBuildWorker,
  type ExportBuildJobData,
} from "../../../worker/src/jobs/export-build.js";

const TS = "2026-01-01T10:00:00.000Z";

function truthRow(eventId: string) {
  return {
    event_id: eventId,
    ts: TS,
    type: "payment",
    status: "approved",
    amount: 10,
    currency: "INR",
    consumer_id: "c1",
    consumer_name: "Asha",
    merchant_id: "m1",
    merchant_name: "Shop",
    counterparty_id: null,
    counterparty_name: null,
    channel: "upi",
    partition_no: 0,
  };
}

function labelRow(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId,
    is_fraud: false,
    typology: null,
    actor_id: null,
    campaign_step: null,
    corruption_type: null,
    corruption_detail: null,
    sink: null,
    delivery_outcome: null,
    ...overrides,
  };
}

function deliveredRow(eventId: string, deliveryId: string) {
  return {
    delivery_id: deliveryId,
    ...truthRow(eventId),
    delivered_at: TS,
    sent_at: null,
  };
}

// Testcontainers MySQL + Redis, with the real export-build worker running in-process. Exports
// are asynchronous (R19): POST queues, the worker builds, GET reports the status.
// Run via `pnpm test:integration`.
describe("truth/exports contract", () => {
  let mysql: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: FastifyInstance;
  let worker: Worker<ExportBuildJobData>;
  let dataDir: string;
  let archiveRunId: string;
  let brokerOnlyRunId: string;

  const sinks = (list: { type: string; name: string }[]) => ({ output: { sinks: list } });

  async function createRun(spec: object): Promise<string> {
    const db = getDb();
    const scenario = await new ScenarioRepository(db).create({
      name: `Export ${Math.random()}`,
      currency: "INR",
    });
    const version = await new SpecVersionRepository(db).create({
      scenario_id: scenario.id,
      spec,
      author_type: "user",
    });
    const run = await new RunRepository(db).create({
      scenario_id: scenario.id,
      spec_version_id: version.id,
      spec_snapshot: spec,
      seed: 1n,
      params: {},
      mode: "history_only",
    });
    return run.id;
  }

  async function requestExport(runId: string, payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: `/api/v1/runs/${runId}/exports`, payload });
  }

  async function untilFinished(runId: string, exportId: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/runs/${runId}/exports/${exportId}`,
      });
      const manifest = response.json();
      if (manifest.status === "completed" || manifest.status === "failed") return manifest;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("export never finished");
  }

  const exportFile = (runId: string, exportId: string, name: string) =>
    readFile(path.join(dataDir, "runs", runId, "exports", exportId, name), "utf-8");

  beforeAll(async () => {
    [mysql, redis] = await Promise.all([
      new GenericContainer("mysql:8.4")
        .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
        .withExposedPorts(3306)
        .start(),
      new GenericContainer("redis:7-alpine").withExposedPorts(6379).start(),
    ]);
    process.env.DATABASE_URL = `mysql://root:test@${mysql.getHost()}:${mysql.getMappedPort(3306)}/txloom_test`;
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-exports-"));
    process.env.DATA_DIR = dataDir;

    await getDb().migrate.latest();
    app = await buildApp();
    worker = startExportBuildWorker({ connection: getQueues().exportBuild.opts.connection! });

    // A run with a file sink "archive" and a broker sink "events": 3 truth events, the file
    // sink delivered 4 rows (one duplicate), and one imperfection plus one failed delivery.
    archiveRunId = await createRun(
      sinks([
        { type: "kafka", name: "events" },
        { type: "file", name: "archive" },
      ]),
    );
    const runDir = path.join(dataDir, "runs", archiveRunId);
    const ids = ["e1", "e2", "e3"];
    await writeParquet(
      path.join(runDir, "truth", "part-0.parquet"),
      TRUTH_EVENT_SCHEMA,
      ids.map(truthRow),
    );
    await writeParquet(
      path.join(runDir, "labels", "part-0.parquet"),
      LABEL_RECORD_SCHEMA,
      ids.map((id) =>
        labelRow(id, id === "e2" ? { is_fraud: true, typology: "card_testing" } : {}),
      ),
    );
    const delivered = [
      deliveredRow("e1", "d1"),
      deliveredRow("e2", "d2"),
      deliveredRow("e2", "d2b"),
      deliveredRow("e3", "d3"),
    ];
    await writeParquet(
      path.join(runDir, "delivered", "archive", "part-0.parquet"),
      DELIVERED_EVENT_SCHEMA,
      delivered,
    );
    await writeParquet(
      path.join(runDir, "delivered", "archive", "labels-part-0.parquet"),
      LABEL_RECORD_SCHEMA,
      delivered.map((d) =>
        labelRow(
          d.event_id,
          d.event_id === "e2" ? { is_fraud: true, typology: "card_testing" } : {},
        ),
      ),
    );
    await writeParquet(
      path.join(runDir, "corruptions", "archive", "part-0.parquet"),
      LABEL_RECORD_SCHEMA,
      [
        labelRow("e2", {
          sink: "archive",
          corruption_type: "duplicate",
          corruption_detail: '{"ordinal":1}',
        }),
      ],
    );
    await writeParquet(
      path.join(runDir, "deliveries", "events", "dropped-0.parquet"),
      LABEL_RECORD_SCHEMA,
      [
        labelRow("e3", {
          sink: "events",
          delivery_outcome: "dropped",
          corruption_detail: '{"error":"HTTP 500","attempts":5}',
        }),
      ],
    );

    brokerOnlyRunId = await createRun(sinks([{ type: "kafka", name: "events" }]));
    await writeParquet(
      path.join(dataDir, "runs", brokerOnlyRunId, "truth", "part-0.parquet"),
      TRUTH_EVENT_SCHEMA,
      [truthRow("t1")],
    );
    await writeParquet(
      path.join(dataDir, "runs", brokerOnlyRunId, "labels", "part-0.parquet"),
      LABEL_RECORD_SCHEMA,
      [labelRow("t1")],
    );
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await closeQueues();
    await closeDb();
    await mysql?.stop();
    await redis?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("POST returns 202 queued, and polling reaches completed", async () => {
    const response = await requestExport(archiveRunId, { format: "csv" });
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("queued");
    const manifest = await untilFinished(archiveRunId, response.json().export_id);
    expect(manifest.status).toBe("completed");
    expect(manifest.finished_at).toBeTruthy();
  });

  it("an unknown sink source ends failed with an error", async () => {
    const response = await requestExport(archiveRunId, {
      format: "csv",
      source: { kind: "sink", name: "no-such-sink" },
    });
    expect(response.statusCode).toBe(202);
    const manifest = await untilFinished(archiveRunId, response.json().export_id);
    expect(manifest.status).toBe("failed");
    expect(manifest.error).toMatch(/no-such-sink/);
  });

  it("source sink exports that sink's delivered copy, with delivery_id and delivered_at", async () => {
    const response = await requestExport(archiveRunId, {
      format: "csv",
      source: { kind: "sink", name: "archive" },
    });
    const manifest = await untilFinished(archiveRunId, response.json().export_id);
    expect(manifest.status).toBe("completed");
    const lines = (await exportFile(archiveRunId, manifest.export_id, "data.csv"))
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1 + 4);
    expect(lines[0]).toContain("delivery_id");
    expect(lines[0]).toContain("delivered_at");
  });

  it("defaults to the first file sink, else truth", async () => {
    const withFileSink = await requestExport(archiveRunId, { format: "json" });
    expect(withFileSink.json().source).toEqual({ kind: "sink", name: "archive" });
    const withoutFileSink = await requestExport(brokerOnlyRunId, { format: "json" });
    expect(withoutFileSink.json().source).toEqual({ kind: "truth" });
    const done = await untilFinished(brokerOnlyRunId, withoutFileSink.json().export_id);
    expect(done.status).toBe("completed");
    expect(JSON.parse(await exportFile(brokerOnlyRunId, done.export_id, "data.json"))).toHaveLength(
      1,
    );
  });

  it("a sink source's answer key lists corruptions and dropped deliveries", async () => {
    const response = await requestExport(archiveRunId, {
      format: "csv",
      source: { kind: "sink", name: "archive" },
    });
    const manifest = await untilFinished(archiveRunId, response.json().export_id);
    expect(manifest.answer_key_file_name).toBe("labels.csv");
    const key = await exportFile(archiveRunId, manifest.export_id, "labels.csv");
    expect(key).toContain("duplicate");
    // The dropped delivery belongs to the broker sink, so it is not in the archive's key.
    expect(key).not.toContain("dropped");

    const events = await requestExport(archiveRunId, {
      format: "csv",
      source: { kind: "sink", name: "events" },
    });
    // "events" has no delivered output in this run, so that export fails rather than lying.
    expect((await untilFinished(archiveRunId, events.json().export_id)).status).toBe("failed");
  });

  it("the truth source's answer key is labels/ only", async () => {
    const response = await requestExport(archiveRunId, {
      format: "csv",
      source: { kind: "truth" },
    });
    const manifest = await untilFinished(archiveRunId, response.json().export_id);
    const key = (await exportFile(archiveRunId, manifest.export_id, "labels.csv"))
      .trim()
      .split("\n");
    expect(key).toHaveLength(1 + 3);
    expect(key.join("\n")).not.toContain("duplicate");
    expect(key.join("\n")).not.toContain("dropped");
  });

  it("include_labels:true without acknowledged_warning returns 422 (FR-022)", async () => {
    const response = await requestExport(archiveRunId, { format: "csv", include_labels: true });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("label_warning_required");
  });

  it("include_labels with the acknowledgement merges every label field and has no answer-key file", async () => {
    const response = await requestExport(archiveRunId, {
      format: "csv",
      include_labels: true,
      acknowledged_warning: true,
      source: { kind: "truth" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().answer_key_file_name).toBeNull();
    const manifest = await untilFinished(archiveRunId, response.json().export_id);
    const lines = (await exportFile(archiveRunId, manifest.export_id, "data.csv"))
      .trim()
      .split("\n");
    const header = lines[0]!.split(",");
    for (const column of [
      "is_fraud",
      "typology",
      "actor_id",
      "campaign_step",
      "corruption_type",
      "delivery_outcome",
    ]) {
      expect(header).toContain(column);
    }
    expect(lines.find((line) => line.startsWith("e2"))).toContain("card_testing");
  });

  it("a completed export downloads; an unknown export 404s", async () => {
    const response = await requestExport(archiveRunId, {
      format: "csv",
      source: { kind: "truth" },
    });
    const manifest = await untilFinished(archiveRunId, response.json().export_id);
    const download = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${archiveRunId}/exports/${manifest.export_id}/download`,
    });
    expect(download.statusCode).toBe(200);
    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${archiveRunId}/exports/nonexistent/download`,
    });
    expect(missing.statusCode).toBe(404);
  });
});
