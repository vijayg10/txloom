import type { Knex } from "knex";
import { ulid } from "ulid";

export interface SessionDestination {
  sink: string;
  connection_id: string;
  topic?: string;
  routing_key?: string;
  label_topic?: string;
}

export type ResumeFrom =
  { kind: "history_end" } | { kind: "session"; session_id: string; day_index: number };

export interface StreamSessionRow {
  id: string;
  stream_id: string;
  seq: number;
  engine_version: number;
  destinations_snapshot: SessionDestination[];
  resume_from: ResumeFrom;
  sim_time_ms: number | null;
  delivered: number;
  failed: number;
  duplicates_injected: number;
  delivered_since_checkpoint: number;
  last_checkpoint_day: number | null;
  last_error: string | null;
  started_at: Date;
  ended_at: Date | null;
}

export interface CreateSessionInput {
  stream_id: string;
  engine_version: number;
  destinations: SessionDestination[];
  resume_from: ResumeFrom;
}

/** `stream_sessions`: one row per stream start (data-model.md §1.7). A session is "active"
 * until `ended_at` is set, which the stream-drive worker does when its job exits. */
export class StreamSessionRepository {
  constructor(private readonly db: Knex) {}

  async create(input: CreateSessionInput): Promise<StreamSessionRow> {
    const id = ulid();
    // seq is stream-local and gapless; UNIQUE(stream_id, seq) turns a racing double start
    // into an error instead of two sessions with one number.
    const last = await this.db("stream_sessions")
      .where({ stream_id: input.stream_id })
      .max<{ seq: number | null }>("seq as seq")
      .first();
    await this.db("stream_sessions").insert({
      id,
      stream_id: input.stream_id,
      seq: (last?.seq ?? 0) + 1,
      engine_version: input.engine_version,
      destinations_snapshot: JSON.stringify(input.destinations),
      resume_from: JSON.stringify(input.resume_from),
    });
    const row = await this.getById(id);
    if (!row) throw new Error("stream session insert did not round-trip");
    return row;
  }

  getById(id: string): Promise<StreamSessionRow | undefined> {
    return this.db<StreamSessionRow>("stream_sessions").where({ id }).first();
  }

  listByStream(streamId: string): Promise<StreamSessionRow[]> {
    return this.db<StreamSessionRow>("stream_sessions")
      .where({ stream_id: streamId })
      .orderBy("seq", "asc");
  }

  /** Sessions still running, across every stream — what `TXLOOM_MAX_STREAMS` limits. */
  async countActive(): Promise<number> {
    const row = await this.db("stream_sessions")
      .whereNull("ended_at")
      .count<{ n: number | string }>("id as n")
      .first();
    return Number(row?.n ?? 0);
  }

  async recordProgress(
    id: string,
    progress: { delivered: number; failed: number; simTimeMs?: number },
  ): Promise<void> {
    await this.db("stream_sessions")
      .where({ id })
      .update({
        delivered: progress.delivered,
        failed: progress.failed,
        ...(progress.simTimeMs !== undefined ? { sim_time_ms: progress.simTimeMs } : {}),
      });
  }

  async end(id: string, error?: string): Promise<void> {
    await this.db("stream_sessions")
      .where({ id })
      .whereNull("ended_at")
      .update({ ended_at: this.db.fn.now(), ...(error ? { last_error: error } : {}) });
  }
}
