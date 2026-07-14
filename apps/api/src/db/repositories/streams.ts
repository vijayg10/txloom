import type { Knex } from "knex";
import { ulid } from "ulid";

export type StreamState = "idle" | "streaming" | "paused" | "stopped";

export interface StreamRow {
  id: string;
  run_id: string;
  state: StreamState;
  target_tps: number;
  label_channel_enabled: boolean;
  metrics: unknown;
  started_at: Date | null;
  stopped_at: Date | null;
}

export interface CreateStreamInput {
  run_id: string;
  target_tps: number;
  label_channel_enabled: boolean;
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
}
