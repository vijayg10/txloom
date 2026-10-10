import type { Knex } from "knex";

export type DeliveryState = "pending" | "running" | "done" | "failed" | "skipped";

export interface DeliveryCursor {
  /** Index into the sink's `delivered/` segment list, in partition then file order. */
  file_index: number;
  /** Rows of that file already handled. */
  row: number;
}

export interface DeliveryDestinationSnapshot {
  sink: string;
  connection_id: string | null;
  connection_name?: string;
  connection_type?: string;
  topic?: string;
  routing_key?: string;
}

export interface RunDeliveryRow {
  run_id: string;
  sink_name: string;
  state: DeliveryState;
  cursor: DeliveryCursor | null;
  total: number;
  published: number;
  failed: number;
  destination_snapshot: DeliveryDestinationSnapshot | null;
  last_error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

/** MySQL returns BIGINT as a string past 2^53 and JSON as already-parsed or a string,
 * depending on the driver path; normalise both. */
function normalise(row: Record<string, unknown>): RunDeliveryRow {
  const json = (value: unknown) =>
    typeof value === "string" ? (JSON.parse(value) as unknown) : (value ?? null);
  return {
    ...(row as unknown as RunDeliveryRow),
    cursor: json(row.cursor) as DeliveryCursor | null,
    destination_snapshot: json(row.destination_snapshot) as DeliveryDestinationSnapshot | null,
    total: Number(row.total),
    published: Number(row.published),
    failed: Number(row.failed),
  };
}

/** A delivery as the API reports it (contracts/api.md): `sink`, not the column's `sink_name`. */
export function serializeDelivery(row: RunDeliveryRow) {
  return {
    sink: row.sink_name,
    state: row.state,
    published: row.published,
    failed: row.failed,
    total: row.total,
    cursor: row.cursor,
    destination_snapshot: row.destination_snapshot,
    last_error: row.last_error,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

/** `run_deliveries` (data-model.md §1.6): the history replay of one sink. */
export class RunDeliveryRepository {
  constructor(private readonly db: Knex) {}

  async create(input: {
    run_id: string;
    sink_name: string;
    destination_snapshot: DeliveryDestinationSnapshot;
  }): Promise<void> {
    await this.db("run_deliveries")
      .insert({
        run_id: input.run_id,
        sink_name: input.sink_name,
        destination_snapshot: JSON.stringify(input.destination_snapshot),
      })
      .onConflict(["run_id", "sink_name"])
      .ignore();
  }

  async get(runId: string, sinkName: string): Promise<RunDeliveryRow | undefined> {
    const row = await this.db("run_deliveries")
      .where({ run_id: runId, sink_name: sinkName })
      .first();
    return row ? normalise(row) : undefined;
  }

  async listByRun(runId: string): Promise<RunDeliveryRow[]> {
    const rows = await this.db("run_deliveries").where({ run_id: runId }).orderBy("sink_name");
    return rows.map(normalise);
  }

  /** Whether any replay still blocks the live phase: pending, running or failed. */
  async hasBlocking(runId: string): Promise<boolean> {
    const row = await this.db("run_deliveries")
      .where({ run_id: runId })
      .whereIn("state", ["pending", "running", "failed"])
      .first("sink_name");
    return !!row;
  }

  async markRunning(runId: string, sinkName: string, total?: number): Promise<void> {
    await this.db("run_deliveries")
      .where({ run_id: runId, sink_name: sinkName })
      .update({
        state: "running",
        last_error: null,
        finished_at: null,
        started_at: this.db.raw("COALESCE(started_at, CURRENT_TIMESTAMP)"),
        ...(total !== undefined ? { total } : {}),
      });
  }

  async recordProgress(
    runId: string,
    sinkName: string,
    progress: { cursor: DeliveryCursor; published: number; failed: number },
  ): Promise<void> {
    await this.db("run_deliveries")
      .where({ run_id: runId, sink_name: sinkName })
      .update({
        cursor: JSON.stringify(progress.cursor),
        published: progress.published,
        failed: progress.failed,
      });
  }

  async finish(
    runId: string,
    sinkName: string,
    outcome: { state: "done" | "failed"; error?: string },
  ): Promise<void> {
    await this.db("run_deliveries")
      .where({ run_id: runId, sink_name: sinkName })
      .update({
        state: outcome.state,
        last_error: outcome.error ?? null,
        finished_at: this.db.fn.now(),
      });
  }

  async setState(runId: string, sinkName: string, state: DeliveryState): Promise<void> {
    await this.db("run_deliveries")
      .where({ run_id: runId, sink_name: sinkName })
      .update({ state, ...(state === "skipped" ? { finished_at: this.db.fn.now() } : {}) });
  }
}
