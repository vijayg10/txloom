import type { Knex } from "knex";
import { ulid } from "ulid";

export type RunMode = "history_only" | "history_then_live";
export type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface RunRow {
  id: string;
  scenario_id: string;
  spec_version_id: string;
  spec_snapshot: unknown;
  seed: string;
  params: unknown;
  mode: RunMode;
  status: RunStatus;
  engine_version: number;
  partition_count: number;
  replay_history: boolean;
  target_tps: number | null;
  label_channel: boolean;
  source_run_id: string | null;
  retry_count: number;
  outputs_deleted_at: Date | null;
  progress: unknown;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface CreateRunInput {
  scenario_id: string;
  spec_version_id: string;
  spec_snapshot: unknown;
  seed: bigint;
  params: unknown;
  mode: RunMode;
  engine_version: number;
  partition_count: number;
  replay_history?: boolean;
  target_tps?: number | null;
  label_channel?: boolean;
  source_run_id?: string | null;
}

export class RunRepository {
  constructor(private readonly db: Knex) {}

  /** `seed` is BIGINT UNSIGNED (up to 2^64-1); the driver would round it to a double, so it is
   * always read back as text (research R2). */
  private runs() {
    return this.db<RunRow>("runs").select("runs.*", this.db.raw("CAST(runs.seed AS CHAR) AS seed"));
  }

  async create(input: CreateRunInput): Promise<RunRow> {
    const id = ulid();
    await this.db("runs").insert({
      id,
      scenario_id: input.scenario_id,
      spec_version_id: input.spec_version_id,
      spec_snapshot: JSON.stringify(input.spec_snapshot),
      seed: input.seed.toString(),
      params: JSON.stringify(input.params),
      mode: input.mode,
      engine_version: input.engine_version,
      partition_count: input.partition_count,
      replay_history: input.replay_history ?? false,
      target_tps: input.target_tps ?? null,
      label_channel: input.label_channel ?? false,
      source_run_id: input.source_run_id ?? null,
      status: "queued",
    });
    const row = await this.getById(id);
    if (!row) throw new Error("run insert did not round-trip");
    return row;
  }

  getById(id: string): Promise<RunRow | undefined> {
    return this.runs().where({ id }).first();
  }

  list(limit = 50, cursor?: string): Promise<RunRow[]> {
    const query = this.runs().orderBy("created_at", "desc").limit(limit);
    if (cursor) query.where("id", "<", cursor);
    return query;
  }

  listByStatus(status: RunStatus): Promise<RunRow[]> {
    return this.runs().where({ status });
  }

  async setStatus(
    id: string,
    status: RunStatus,
    extra: Partial<Pick<RunRow, "error">> = {},
  ): Promise<void> {
    const patch: Record<string, unknown> = { status, ...extra };
    if (status === "running") patch.started_at = this.db.fn.now();
    if (status === "running") patch.completed_at = null;
    if (status === "running" && extra.error === undefined) patch.error = null;
    if (status === "completed" || status === "failed" || status === "cancelled")
      patch.completed_at = this.db.fn.now();
    await this.db("runs").where({ id }).update(patch);
  }

  async incrementRetryCount(id: string): Promise<number> {
    await this.db("runs").where({ id }).increment("retry_count", 1);
    const row = await this.db("runs").where({ id }).first("retry_count");
    return row?.retry_count ?? 0;
  }

  async setProgress(id: string, progress: unknown): Promise<void> {
    await this.db("runs")
      .where({ id })
      .update({ progress: JSON.stringify(progress) });
  }

  async markOutputsDeleted(id: string): Promise<void> {
    await this.db("runs").where({ id }).update({ outputs_deleted_at: this.db.fn.now() });
  }
}

export type PartitionState = "pending" | "running" | "done" | "failed";

export interface RunPartitionRow {
  run_id: string;
  partition_no: number;
  state: PartitionState;
  rng_checkpoint: unknown;
  events_generated: number;
  attempts: number;
  last_error: string | null;
  updated_at: Date;
}

export class RunPartitionRepository {
  constructor(private readonly db: Knex) {}

  async createPending(runId: string, partitionCount: number): Promise<void> {
    const rows = Array.from({ length: partitionCount }, (_, partitionNo) => ({
      run_id: runId,
      partition_no: partitionNo,
      state: "pending" as const,
      events_generated: 0,
    }));
    await this.db("run_partitions").insert(rows);
  }

  listByRun(runId: string): Promise<RunPartitionRow[]> {
    return this.db<RunPartitionRow>("run_partitions")
      .where({ run_id: runId })
      .orderBy("partition_no", "asc");
  }

  async setState(runId: string, partitionNo: number, state: PartitionState): Promise<void> {
    await this.db("run_partitions")
      .where({ run_id: runId, partition_no: partitionNo })
      .update({ state, updated_at: this.db.fn.now() });
  }

  async checkpoint(
    runId: string,
    partitionNo: number,
    checkpoint: unknown,
    eventsGenerated: number,
  ): Promise<void> {
    await this.db("run_partitions")
      .where({ run_id: runId, partition_no: partitionNo })
      .update({
        rng_checkpoint: JSON.stringify(checkpoint),
        events_generated: eventsGenerated,
        updated_at: this.db.fn.now(),
      });
  }

  async recordAttempt(
    runId: string,
    partitionNo: number,
    attempts: number,
    error: string | null,
  ): Promise<void> {
    await this.db("run_partitions").where({ run_id: runId, partition_no: partitionNo }).update({
      attempts,
      last_error: error,
      updated_at: this.db.fn.now(),
    });
  }
}
