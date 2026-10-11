import type { Knex } from "knex";

export interface DestinationDefaultRow {
  scenario_id: string;
  sink_name: string;
  connection_id: string | null;
  topic: string | null;
  routing_key: string | null;
  label_topic: string | null;
  updated_at: Date;
}

export interface DestinationDefaultInput {
  sink_name: string;
  connection_id: string;
  topic?: string;
  routing_key?: string;
  label_topic?: string;
}

/** `scenario_destination_defaults` (data-model.md §1.5): upserted on every launch so the
 * Launch panel can prefill (FR-019). Rows whose `sink_name` no longer exists in the
 * current spec are simply ignored by the caller when prefilling. */
export class DestinationDefaultsRepository {
  constructor(private readonly db: Knex) {}

  async upsertAll(scenarioId: string, destinations: DestinationDefaultInput[]): Promise<void> {
    for (const d of destinations) {
      await this.db("scenario_destination_defaults")
        .insert({
          scenario_id: scenarioId,
          sink_name: d.sink_name,
          connection_id: d.connection_id,
          topic: d.topic ?? null,
          routing_key: d.routing_key ?? null,
          label_topic: d.label_topic ?? null,
          updated_at: this.db.fn.now(),
        })
        .onConflict(["scenario_id", "sink_name"])
        .merge();
    }
  }

  listByScenario(scenarioId: string): Promise<DestinationDefaultRow[]> {
    return this.db<DestinationDefaultRow>("scenario_destination_defaults").where({
      scenario_id: scenarioId,
    });
  }
}
