import type { Knex } from "knex";
import { ulid } from "ulid";

export type RunMode = "batch" | "batch_then_stream";
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
}

export class RunRepository {
  constructor(private readonly db: Knex) {}

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
      status: "queued",
    });
    const row = await this.getById(id);
    if (!row) throw new Error("run insert did not round-trip");
    return row;
  }

  getById(id: string): Promise<RunRow | undefined> {
    return this.db<RunRow>("runs").where({ id }).first();
  }

  list(limit = 50, cursor?: string): Promise<RunRow[]> {
    const query = this.db<RunRow>("runs").orderBy("created_at", "desc").limit(limit);
    if (cursor) query.where("id", "<", cursor);
    return query;
  }

  async setStatus(
    id: string,
    status: RunStatus,
    extra: Partial<Pick<RunRow, "error">> = {},
  ): Promise<void> {
    const patch: Record<string, unknown> = { status, ...extra };
    if (status === "running") patch.started_at = this.db.fn.now();
    if (status === "completed" || status === "failed" || status === "cancelled")
      patch.completed_at = this.db.fn.now();
    await this.db("runs").where({ id }).update(patch);
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
}
