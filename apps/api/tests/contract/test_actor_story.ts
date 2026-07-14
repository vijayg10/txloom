import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { writeParquet, TRUTH_EVENT_SCHEMA, LABEL_RECORD_SCHEMA } from "@txloom/sinks";
import { buildApp } from "../../src/app.js";

function truthEvent(eventId: string, ts: string, amount: number) {
  return {
    event_id: eventId,
    ts,
    type: "p2p_transfer",
    status: "approved",
    amount,
    currency: "INR",
    consumer_id: "cons_0",
    consumer_name: "Aisha Khan",
    merchant_id: null,
    merchant_name: null,
    counterparty_id: "cons_1",
    counterparty_name: "Rohan Verma",
    channel: "upi",
    partition_no: 0,
  };
}

function label(eventId: string, actorId: string, campaignStep: number) {
  return {
    event_id: eventId,
    is_fraud: true,
    typology: "account_takeover",
    actor_id: actorId,
    campaign_step: campaignStep,
    corruption_type: null,
    corruption_detail: null,
    sink: null,
  };
}

const runId = "actor-story-test-run";

// GET /runs/:id/truth/actors/:actorId/story is a pure file-scan over the run
// output volume — no DB involved — so this reads/writes fixture Parquet
// segments directly rather than driving a full generate → store loop.
describe("actor story contract", () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-actor-story-"));
    process.env.DATA_DIR = dataDir;
    app = await buildApp({ skipDb: false });

    // A 3-step account-takeover script, written out of order to prove the
    // route sorts by campaign_step rather than insertion/file order.
    const events = [
      truthEvent("evt_2", "2026-01-05T00:30:00.000Z", 900),
      truthEvent("evt_0", "2026-01-05T00:00:00.000Z", 500),
      truthEvent("evt_1", "2026-01-05T00:15:00.000Z", 700),
      truthEvent("evt_unrelated", "2026-01-05T01:00:00.000Z", 50),
    ];
    const labels = [
      label("evt_2", "actor_p0_0", 2),
      label("evt_0", "actor_p0_0", 0),
      label("evt_1", "actor_p0_0", 1),
      label("evt_unrelated", "actor_p0_9", 0),
    ];

    const runDir = path.join(dataDir, "runs", runId);
    await writeParquet(path.join(runDir, "truth", "part-0.parquet"), TRUTH_EVENT_SCHEMA, events);
    await writeParquet(path.join(runDir, "labels", "part-0.parquet"), LABEL_RECORD_SCHEMA, labels);
  });

  afterAll(async () => {
    await app?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("returns the actor's campaign steps in order regardless of file order", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${runId}/truth/actors/actor_p0_0/story`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.actor_id).toBe("actor_p0_0");
    expect(body.typology).toBe("account_takeover");
    expect(body.steps.map((s: { campaign_step: number }) => s.campaign_step)).toEqual([0, 1, 2]);
    expect(body.steps.map((s: { event: { event_id: string } }) => s.event.event_id)).toEqual([
      "evt_0",
      "evt_1",
      "evt_2",
    ]);
  });

  it("404s for an actor with no campaign", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${runId}/truth/actors/nonexistent/story`,
    });
    expect(response.statusCode).toBe(404);
  });
});
