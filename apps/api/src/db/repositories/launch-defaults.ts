import type { Knex } from "knex";

export type RunMode = "history_only" | "history_then_live";

export interface LaunchDefaultsRow {
  scenario_id: string;
  mode: RunMode;
  target_tps: number | null;
  replay_history: boolean;
  label_channel: boolean;
  updated_at: Date;
}

export interface UpsertLaunchDefaultsInput {
  mode: RunMode;
  target_tps?: number | null;
  replay_history: boolean;
  label_channel: boolean;
}

/** `scenario_launch_defaults` (data-model.md §1.5a): one row per scenario, upserted on
 * every launch (FR-019, SC-002) so relaunching takes one click. */
export class LaunchDefaultsRepository {
  constructor(private readonly db: Knex) {}

  async upsert(scenarioId: string, input: UpsertLaunchDefaultsInput): Promise<void> {
    await this.db("scenario_launch_defaults")
      .insert({
        scenario_id: scenarioId,
        mode: input.mode,
        target_tps: input.target_tps ?? null,
        replay_history: input.replay_history,
        label_channel: input.label_channel,
        updated_at: this.db.fn.now(),
      })
      .onConflict("scenario_id")
      .merge();
  }

  async getByScenario(scenarioId: string): Promise<LaunchDefaultsRow | undefined> {
    const row = await this.db<LaunchDefaultsRow>("scenario_launch_defaults")
      .where({ scenario_id: scenarioId })
      .first();
    // MySQL returns TINYINT(1) as 0/1.
    return row
      ? {
          ...row,
          replay_history: Boolean(row.replay_history),
          label_channel: Boolean(row.label_channel),
        }
      : undefined;
  }
}
