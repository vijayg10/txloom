import type { Knex } from "knex";

export type ConnectionType = "kafka" | "rabbitmq" | "webhook";

export interface RunDestinationRow {
  run_id: string;
  sink_name: string;
  connection_id: string | null;
  connection_name: string;
  connection_type: ConnectionType;
  topic: string | null;
  routing_key: string | null;
  label_topic: string | null;
  created_at: Date;
}

export interface RunDestinationInput {
  sink_name: string;
  connection_id: string;
  connection_name: string;
  connection_type: ConnectionType;
  topic?: string;
  routing_key?: string;
  label_topic?: string;
}

/** `run_destinations` (data-model.md §1.4): the immutable audit record of where a run was
 * sent at launch — insert-only, never updated after (the spec edge case "keep the
 * destination as at launch"). */
export class RunDestinationRepository {
  constructor(private readonly db: Knex) {}

  async insertAll(runId: string, destinations: RunDestinationInput[]): Promise<void> {
    if (destinations.length === 0) return;
    await this.db("run_destinations").insert(
      destinations.map((d) => ({
        run_id: runId,
        sink_name: d.sink_name,
        connection_id: d.connection_id,
        connection_name: d.connection_name,
        connection_type: d.connection_type,
        topic: d.topic ?? null,
        routing_key: d.routing_key ?? null,
        label_topic: d.label_topic ?? null,
      })),
    );
  }

  listByRun(runId: string): Promise<RunDestinationRow[]> {
    return this.db<RunDestinationRow>("run_destinations").where({ run_id: runId });
  }
}
