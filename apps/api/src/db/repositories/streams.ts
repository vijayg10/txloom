import type { Knex } from "knex";
import { ulid } from "ulid";
import type { SessionDestination } from "./stream-sessions.js";

export type StreamState = "idle" | "streaming" | "paused" | "stopped" | "error";

export interface StreamRow {
  id: string;
  run_id: string;
  state: StreamState;
  target_tps: number;
  label_channel_enabled: boolean;
  metrics: unknown;
  destinations: SessionDestination[] | string | null;
  current_session_id: string | null;
  last_error: string | null;
  started_at: Date | null;
  stopped_at: Date | null;
}

export interface CreateStreamInput {
  run_id: string;
  target_tps: number;
  label_channel_enabled: boolean;
  /** Initialized from the run's launch destinations (data-model.md §1.7). */
  destinations: SessionDestination[];
}

/** `streams` repository — one row per run's live phase, lifecycle
 * `idle → streaming ⇄ paused → stopped` (data-model.md § streams). Lifecycle
 * validity (which transitions are legal from which state) is enforced by the
 * route layer, matching the run_control.ts convention. */
export class StreamRepository {
  constructor(private readonly db: Knex) {}

  async create(input: CreateStreamInput): Promise<StreamRow> {
    const id = ulid();
    await this.db("streams").insert({
      id,
      run_id: input.run_id,
      state: "idle",
      target_tps: input.target_tps,
      label_channel_enabled: input.label_channel_enabled,
      destinations: JSON.stringify(input.destinations),
    });
    const row = await this.getById(id);
    if (!row) throw new Error("stream insert did not round-trip");
    return row;
  }

  getById(id: string): Promise<StreamRow | undefined> {
    return this.db<StreamRow>("streams").where({ id }).first();
  }

  getByRunId(runId: string): Promise<StreamRow | undefined> {
    return this.db<StreamRow>("streams").where({ run_id: runId }).first();
  }

  async setState(id: string, state: StreamState): Promise<void> {
    const patch: Record<string, unknown> = { state };
    if (state === "streaming") patch.started_at = this.db.fn.now();
    if (state === "stopped") patch.stopped_at = this.db.fn.now();
    await this.db("streams").where({ id }).update(patch);
  }

  async setTargetTps(id: string, targetTps: number): Promise<void> {
    await this.db("streams").where({ id }).update({ target_tps: targetTps });
  }

  async setMetrics(id: string, metrics: unknown): Promise<void> {
    await this.db("streams")
      .where({ id })
      .update({ metrics: JSON.stringify(metrics) });
  }

  async setDestinations(id: string, destinations: SessionDestination[]): Promise<void> {
    await this.db("streams")
      .where({ id })
      .update({ destinations: JSON.stringify(destinations) });
  }

  async setCurrentSession(id: string, sessionId: string): Promise<void> {
    await this.db("streams").where({ id }).update({ current_session_id: sessionId });
  }

  async setLastError(id: string, error: string | null): Promise<void> {
    await this.db("streams").where({ id }).update({ last_error: error });
  }

  listByState(states: readonly StreamState[]): Promise<StreamRow[]> {
    return this.db<StreamRow>("streams").whereIn("state", [...states]);
  }
}

/** `destinations` comes back from MySQL as a JSON string or an array depending on the driver path. */
export function streamDestinations(stream: Pick<StreamRow, "destinations">): SessionDestination[] {
  const raw = stream.destinations;
  if (!raw) return [];
  return typeof raw === "string" ? (JSON.parse(raw) as SessionDestination[]) : raw;
}
