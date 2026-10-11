import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Worker } from "bullmq";
import { getDb } from "../../../api/src/db/knex.js";
import { getQueues } from "../../../api/src/services/queues.js";
import { maybeAutoStartLive } from "../../../api/src/services/stream-sessions.js";
import { StreamRepository } from "../../../api/src/db/repositories/streams.js";
import { StreamSessionRepository } from "../../../api/src/db/repositories/stream-sessions.js";
import { RunDeliveryRepository } from "../../../api/src/db/repositories/run-deliveries.js";
import { createGeneratePartitionCallbacks } from "../../src/handlers.js";
import { startGeneratePartitionWorker } from "../../src/jobs/generate-partition.js";
import { closePartitionPool } from "../../src/pool/piscina-pool.js";
import { queueConnection, startStack, waitFor, type TestStack } from "../support/stack.js";
import { tinySpec } from "../../../api/tests/support/tiny-spec.js";

// The live auto-start (FR-022): a `history_then_live` run creates stream session 1 with the run's
// destinations and rate once generation is complete and every replay is done or skipped.
// Generation runs through the real worker callbacks. Run via `pnpm test:integration`.
describe("live auto-start", () => {
  let stack: TestStack;
  let worker: Worker | undefined;
  let connectionId: string;

  beforeAll(async () => {
    process.env.TXLOOM_MAX_STREAMS = "50"; // every test here leaves its stream running
    stack = await startStack();
    const callbacks = createGeneratePartitionCallbacks({
      db: getDb(),
      queues: getQueues(),
      dataDir: stack.dataDir,
    });
    worker = startGeneratePartitionWorker({ connection: queueConnection(), ...callbacks });
    const connection = await stack.app.inject({
      method: "POST",
      url: "/api/v1/connections",
      payload: { type: "webhook", name: "auto-live-hook", config: { url: "http://localhost:9/x" } },
    });
    connectionId = connection.json().id;
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await closePartitionPool();
    await stack?.stop();
  });

  const streams = () => new StreamRepository(getDb());
  const sessions = () => new StreamSessionRepository(getDb());
  const deliveries = () => new RunDeliveryRepository(getDb());
  const runRow = (runId: string) => getDb()("runs").where({ id: runId }).first();

  /** Launches a run of a spec with one webhook sink, `body` on top of the destination. */
  async function launch(label: string, body: Record<string, unknown>): Promise<string> {
    const scenario = await stack.app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      payload: { name: `Auto live ${label}`, currency: "INR" },
    });
    const scenarioId = scenario.json().id as string;
    const spec = tinySpec({ consumers: 5, days: 2 });
    spec.output.sinks.push({ type: "webhook", name: "live" } as never);
    await stack.app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/versions`,
      payload: { spec },
    });
    const response = await stack.app.inject({
      method: "POST",
      url: `/api/v1/scenarios/${scenarioId}/runs`,
      payload: { destinations: [{ sink: "live", connection_id: connectionId }], ...body },
    });
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  }

  async function waitCompleted(runId: string) {
    await waitFor(async () => (await runRow(runId)).status === "completed", 60_000);
  }

  it("creates session 1 with the run's destinations and target_tps once generation completes", async () => {
    const runId = await launch("basic", { mode: "history_then_live", target_tps: 65 });
    await waitCompleted(runId);
    await waitFor(async () => (await streams().getByRunId(runId))?.state === "streaming", 10_000);

    const stream = (await streams().getByRunId(runId))!;
    expect(stream.state).toBe("streaming");
    expect(stream.target_tps).toBe(65);
    const session = (await sessions().listByStream(stream.id))[0]!;
    expect(session.seq).toBe(1);
    expect(session.destinations_snapshot).toEqual([
      expect.objectContaining({ sink: "live", connection_id: connectionId }),
    ]);
    expect(await getQueues().streamDrive.getJob(`stream-${runId}-1`)).toBeTruthy();
  }, 120_000);

  it("does not start a stream for a history_only run", async () => {
    const runId = await launch("history-only", { mode: "history_only" });
    await waitCompleted(runId);
    expect((await maybeAutoStartLive(getDb(), runId)).started).toBe(false);
    expect(await streams().getByRunId(runId)).toBeUndefined();
  }, 120_000);

  describe("with replay_history", () => {
    async function replayRun(label: string): Promise<string> {
      const runId = await launch(label, { mode: "history_then_live", replay_history: true });
      await waitCompleted(runId);
      // No deliver worker runs here, so the replay stays pending until the test moves it.
      await waitFor(async () => (await deliveries().listByRun(runId)).length === 1, 10_000);
      return runId;
    }

    it("waits while a replay is pending, then starts once it is done", async () => {
      const runId = await replayRun("replay-done");
      expect(await streams().getByRunId(runId)).toBeUndefined();
      expect(await maybeAutoStartLive(getDb(), runId)).toMatchObject({ started: false });

      await deliveries().finish(runId, "live", { state: "done" });
      const outcome = await maybeAutoStartLive(getDb(), runId);
      expect(outcome.started).toBe(true);
      expect((await streams().getByRunId(runId))?.state).toBe("streaming");
    }, 120_000);

    it("starts once the replay is skipped", async () => {
      const runId = await replayRun("replay-skipped");
      await getDb()("run_deliveries").where({ run_id: runId }).update({ state: "skipped" });
      expect((await maybeAutoStartLive(getDb(), runId)).started).toBe(true);
    }, 120_000);

    it("does not start with a failed delivery", async () => {
      const runId = await replayRun("replay-failed");
      await deliveries().finish(runId, "live", { state: "failed", error: "broker unreachable" });
      const outcome = await maybeAutoStartLive(getDb(), runId);
      expect(outcome.started).toBe(false);
      expect(await streams().getByRunId(runId)).toBeUndefined();
    }, 120_000);

    it("starts when a failed delivery is skipped through the API", async () => {
      const runId = await replayRun("replay-skip-api");
      await deliveries().finish(runId, "live", { state: "failed", error: "boom" });
      const skipped = await stack.app.inject({
        method: "POST",
        url: `/api/v1/runs/${runId}/deliveries/live/skip`,
      });
      expect(skipped.statusCode).toBe(200);
      expect((await streams().getByRunId(runId))?.state).toBe("streaming");
    }, 120_000);
  });

  it("never starts a second stream for the same run", async () => {
    const runId = await launch("idempotent", { mode: "history_then_live" });
    await waitCompleted(runId);
    await waitFor(async () => (await streams().getByRunId(runId)) !== undefined, 10_000);
    const again = await maybeAutoStartLive(getDb(), runId);
    expect(again.started).toBe(false);
    const stream = (await streams().getByRunId(runId))!;
    expect(await sessions().listByStream(stream.id)).toHaveLength(1);
  }, 120_000);
});
