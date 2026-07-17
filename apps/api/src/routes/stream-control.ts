import type { FastifyInstance, FastifyReply } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import { generateMerchantPool, defaultPartitionCount } from "@txloom/engine";
import { getDb } from "../db/knex.js";
import { RunRepository } from "../db/repositories/runs.js";
import { StreamRepository, type StreamRow } from "../db/repositories/streams.js";
import { getQueues } from "../services/queues.js";

type StreamSinkBody =
  | { type: "kafka"; config: { brokers: string[]; topic: string } }
  | { type: "rabbitmq"; config: { url: string; exchange: string; routingKey: string } }
  | { type: "webhook"; config: { url: string } };

interface StreamStartBody {
  target_tps?: number;
  sink: StreamSinkBody;
  label_channel_enabled?: boolean;
}

interface StreamRateBody {
  target_tps: number;
}

/**
 * Stream lifecycle (FR-028/029/030): `POST .../stream/start|pause|resume|stop`,
 * `PATCH .../stream` for live rate changes, `GET .../stream` for state +
 * metrics. Continuity with the history phase (FR-029) comes from the
 * `stream-drive` job resuming the same world via `resumeLiveWorld` — this
 * route's only job is to snapshot the run's spec/seed into the job payload
 * and drive the `streams` row's state machine
 * (`idle → streaming ⇄ paused → stopped`); pause/resume never touch the job
 * itself, so its in-memory world state survives a pause untouched.
 *
 * v1 scope note: the sink to stream into is supplied inline in the `start`
 * body (broker list, topic, exchange, webhook URL) rather than resolved from
 * a stored `sink_connection_id` — the Connections & Settings sink-management
 * CRUD surface is User Story 6 scope, independent of this story (tasks.md).
 * When that surface lands, it can resolve a `sink_connection_id` into this
 * same inline shape before calling stream/start, as a non-breaking extension.
 */
export default async function streamControlRoutes(app: FastifyInstance) {
  const db = getDb();
  const runs = new RunRepository(db);
  const streams = new StreamRepository(db);

  function serialize(stream: StreamRow) {
    return {
      ...stream,
      metrics: typeof stream.metrics === "string" ? JSON.parse(stream.metrics) : stream.metrics,
    };
  }

  app.post("/runs/:id/stream/start", async (request, reply) => {
    const { id: runId } = request.params as { id: string };
    const body = request.body as StreamStartBody;

    const run = await runs.getById(runId);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${runId}" not found` } };
    }
    if (run.status !== "completed") {
      reply.status(409);
      return {
        error: {
          code: "invalid_state",
          message: `Run is "${run.status}", not "completed" — the history phase must finish before streaming.`,
        },
      };
    }

    const spec = run.spec_snapshot as SimulationSpec;
    const targetTps = body.target_tps ?? spec.clock.then_stream_tps;
    if (!targetTps || targetTps <= 0) {
      reply.status(400);
      return {
        error: {
          code: "invalid_target_tps",
          message: "target_tps must be a positive number (or spec.clock.then_stream_tps set)",
        },
      };
    }
    if (!body.sink) {
      reply.status(400);
      return { error: { code: "missing_sink", message: "sink is required to start a stream" } };
    }

    let stream = await streams.getByRunId(runId);
    if (stream && stream.state === "streaming") {
      reply.status(409);
      return { error: { code: "invalid_state", message: "Stream is already streaming." } };
    }
    if (!stream) {
      stream = await streams.create({
        run_id: runId,
        target_tps: targetTps,
        label_channel_enabled: body.label_channel_enabled ?? false,
      });
    } else {
      await streams.setTargetTps(stream.id, targetTps);
    }
    await streams.setState(stream.id, "streaming");

    const seed = BigInt(run.seed);
    const partitionCount = defaultPartitionCount(spec.population.consumers.count);
    const merchants = generateMerchantPool(spec, seed);

    const queues = getQueues();
    await queues.streamDrive.add(
      `stream-${runId}`,
      {
        runId,
        streamId: stream.id,
        spec,
        seed: seed.toString(),
        partitionCount,
        merchants,
        sink: body.sink,
        labelChannelEnabled: body.label_channel_enabled ?? false,
      },
      { jobId: `stream-${runId}` },
    );

    const started = await streams.getById(stream.id);
    return serialize(started!);
  });

  async function transition(
    runId: string,
    from: readonly StreamRow["state"][],
    to: StreamRow["state"],
    reply: FastifyReply,
  ) {
    const stream = await streams.getByRunId(runId);
    if (!stream) {
      reply.status(404);
      return { error: { code: "not_found", message: `No stream for run "${runId}"` } };
    }
    if (!from.includes(stream.state)) {
      reply.status(409);
      return {
        error: {
          code: "invalid_state",
          message: `Stream is "${stream.state}" — cannot transition to "${to}" from there.`,
        },
      };
    }
    await streams.setState(stream.id, to);
    return serialize((await streams.getById(stream.id))!);
  }

  app.post("/runs/:id/stream/pause", async (request, reply) => {
    const { id } = request.params as { id: string };
    return transition(id, ["streaming"], "paused", reply);
  });

  app.post("/runs/:id/stream/resume", async (request, reply) => {
    const { id } = request.params as { id: string };
    return transition(id, ["paused"], "streaming", reply);
  });

  app.post("/runs/:id/stream/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    return transition(id, ["streaming", "paused"], "stopped", reply);
  });

  app.patch("/runs/:id/stream", async (request, reply) => {
    const { id: runId } = request.params as { id: string };
    const body = request.body as StreamRateBody;

    const stream = await streams.getByRunId(runId);
    if (!stream) {
      reply.status(404);
      return { error: { code: "not_found", message: `No stream for run "${runId}"` } };
    }
    if (stream.state === "stopped") {
      reply.status(409);
      return {
        error: { code: "invalid_state", message: "Stream is stopped — cannot adjust rate." },
      };
    }
    if (!body.target_tps || body.target_tps <= 0) {
      reply.status(400);
      return {
        error: { code: "invalid_target_tps", message: "target_tps must be a positive number" },
      };
    }

    await streams.setTargetTps(stream.id, body.target_tps);
    return serialize((await streams.getById(stream.id))!);
  });

  app.get("/runs/:id/stream", async (request, reply) => {
    const { id: runId } = request.params as { id: string };
    const stream = await streams.getByRunId(runId);
    if (!stream) {
      reply.status(404);
      return { error: { code: "not_found", message: `No stream for run "${runId}"` } };
    }
    return serialize(stream);
  });
}
