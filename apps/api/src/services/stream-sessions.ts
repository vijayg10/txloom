import type { Knex } from "knex";
import type { SimulationSpec } from "@txloom/spec";
import { ENGINE_VERSION } from "@txloom/engine";
import { RunRepository, type RunRow } from "../db/repositories/runs.js";
import { StreamRepository, type StreamRow } from "../db/repositories/streams.js";
import {
  StreamSessionRepository,
  type SessionDestination,
} from "../db/repositories/stream-sessions.js";
import { RunDeliveryRepository } from "../db/repositories/run-deliveries.js";
import { RunDestinationRepository } from "../db/repositories/run-destinations.js";
import { ConnectionRepository } from "../db/repositories/connections.js";
import { getQueues } from "./queues.js";

/** The run's launch destinations, as a stream's initial destinations. */
export async function launchSessionDestinations(
  db: Knex,
  runId: string,
): Promise<SessionDestination[]> {
  return (await new RunDestinationRepository(db).listByRun(runId))
    .filter((d) => d.connection_id !== null)
    .map((d) => ({
      sink: d.sink_name,
      connection_id: d.connection_id!,
      ...(d.topic ? { topic: d.topic } : {}),
      ...(d.routing_key ? { routing_key: d.routing_key } : {}),
      ...(d.label_topic ? { label_topic: d.label_topic } : {}),
    }));
}

export interface StartSessionInput {
  run: RunRow;
  targetTps: number;
  labelChannelEnabled: boolean;
  destinations: SessionDestination[];
  /** The run's existing stream (idle, stopped or errored), if it has one. */
  stream?: StreamRow | undefined;
}

/**
 * Starts the next live session of a run (FR-022, FR-027): creates the stream on first use, creates
 * session `seq + 1` continuing the run's world from the end of history, marks the stream
 * `streaming` and enqueues the `stream-drive` job. Shared by `POST /runs/:id/stream/start` and the
 * worker's live auto-start, so a manual and an automatic start are the same thing.
 *
 * The job payload carries only connection IDs and targets: the worker resolves and decrypts the
 * connection itself, so no secret enters Redis.
 */
export async function createStreamSession(db: Knex, input: StartSessionInput): Promise<StreamRow> {
  const { run, targetTps, labelChannelEnabled, destinations } = input;
  const streams = new StreamRepository(db);
  const sessions = new StreamSessionRepository(db);
  const spec = run.spec_snapshot as SimulationSpec;

  let stream = input.stream;
  if (!stream) {
    stream = await streams.create({
      run_id: run.id,
      target_tps: targetTps,
      label_channel_enabled: labelChannelEnabled,
      destinations,
    });
  } else {
    await streams.setTargetTps(stream.id, targetTps);
  }

  // Every start is a new session that continues the run's world from the end of history;
  // live-day checkpoints (later) let a restart continue from where the last session stopped.
  // A new session continues from the previous session's final position when it wrote day
  // checkpoints (its last day and how many deliveries of it were made); else from history's end.
  const previous = (await sessions.listByStream(stream.id)).filter(
    (s) => s.last_checkpoint_day !== null && s.last_checkpoint_day !== undefined,
  );
  const last = previous[previous.length - 1];
  const resume = last
    ? {
        sessionId: last.id,
        dayIndex: Number(last.last_checkpoint_day),
        skip: Number(last.delivered_since_checkpoint ?? 0),
      }
    : undefined;
  const session = await sessions.create({
    stream_id: stream.id,
    engine_version: run.engine_version,
    destinations,
    resume_from: resume
      ? { kind: "session", session_id: resume.sessionId, day_index: resume.dayIndex }
      : { kind: "history_end" },
  });
  await streams.setCurrentSession(stream.id, session.id);
  await streams.setLastError(stream.id, null);
  await streams.setState(stream.id, "streaming");

  await getQueues().streamDrive.add(
    `stream-${run.id}-${session.seq}`,
    {
      runId: run.id,
      streamId: stream.id,
      sessionId: session.id,
      sessionSeq: session.seq,
      spec,
      seed: run.seed,
      partitionCount: run.partition_count,
      engineVersion: run.engine_version,
      destinations: destinations.map((d) => ({
        sink: d.sink,
        connectionId: d.connection_id,
        ...(d.topic ? { topic: d.topic } : {}),
        ...(d.routing_key ? { routingKey: d.routing_key } : {}),
        ...(d.label_topic ? { labelTopic: d.label_topic } : {}),
      })),
      labelChannelEnabled,
      ...(resume ? { resume } : {}),
    },
    {
      jobId: `stream-${run.id}-${session.seq}`,
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 604_800 },
    },
  );

  return (await streams.getById(stream.id))!;
}

export type AutoStartOutcome =
  { started: true; stream: StreamRow } | { started: false; reason: string };

/**
 * Starts session 1 of a `history_then_live` run once its history is complete and every replay has
 * finished (`done` or `skipped`) — FR-022. It is safe to call from every place those conditions
 * can become true (generation completing, a delivery finishing, a delivery being skipped): it
 * does nothing unless all of them hold, and never starts a second stream for a run.
 */
export async function maybeAutoStartLive(db: Knex, runId: string): Promise<AutoStartOutcome> {
  const run = await new RunRepository(db).getById(runId);
  if (!run) return { started: false, reason: "run not found" };
  if (run.mode !== "history_then_live") return { started: false, reason: "run is history_only" };
  if (run.status !== "completed") return { started: false, reason: "generation is not complete" };
  if (run.engine_version !== ENGINE_VERSION) {
    return { started: false, reason: "run was made by a different engine version" };
  }
  if (run.replay_history && (await new RunDeliveryRepository(db).hasBlocking(runId))) {
    return { started: false, reason: "history replay has not finished" };
  }
  if (await new StreamRepository(db).getByRunId(runId)) {
    return { started: false, reason: "run already has a stream" };
  }

  const destinations = await launchSessionDestinations(db, runId);
  const connections = new ConnectionRepository(db, process.env.DATA_DIR ?? "./data");
  for (const destination of destinations) {
    if (!(await connections.getById(destination.connection_id))) {
      return { started: false, reason: `connection for sink "${destination.sink}" was deleted` };
    }
  }

  const sessions = new StreamSessionRepository(db);
  const maxStreams = Number(process.env.TXLOOM_MAX_STREAMS) || DEFAULT_MAX_STREAMS;
  if ((await sessions.countActive()) >= maxStreams) {
    return { started: false, reason: "the stream limit is reached" };
  }

  const spec = run.spec_snapshot as SimulationSpec;
  try {
    const stream = await createStreamSession(db, {
      run,
      targetTps: run.target_tps ?? spec.clock.then_stream_tps ?? DEFAULT_TARGET_TPS,
      labelChannelEnabled: run.label_channel,
      destinations,
    });
    return { started: true, stream };
  } catch (error) {
    // Two triggers can race to the same stream (the table is unique on run_id); the loser
    // simply finds it already started.
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return { started: false, reason: "run already has a stream" };
    }
    throw error;
  }
}

export const DEFAULT_MAX_STREAMS = 4;
const DEFAULT_TARGET_TPS = 50;
