import { readdir } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

async function hasParquetFiles(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).some((f) => f.endsWith(".parquet"));
  } catch {
    return false;
  }
}

/** DuckDB can query Parquet files directly (filter/sort/limit pushed down to the
 * storage layer) instead of materializing every row into JS objects per request —
 * the fix for the "v1 scans files directly" shortcut truth-events.ts and
 * actor-story.ts both flagged as a documented follow-up. One in-memory instance is
 * shared across requests; each call gets its own short-lived connection off it. */
let instance: Promise<DuckDBInstance> | null = null;

function getInstance(): Promise<DuckDBInstance> {
  if (!instance) instance = DuckDBInstance.create(":memory:");
  return instance;
}

async function withConnection<T>(fn: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
  const connection = await (await getInstance()).connect();
  try {
    return await fn(connection);
  } finally {
    connection.disconnectSync();
  }
}

/** Single-quoted SQL string literal — the only untrusted input reaching these
 * literals is the run id used to build the glob path, so this just guards
 * against a stray quote rather than a real adversarial input. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface TruthEventRow {
  event_id: string;
  ts: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  consumer_id: string;
  consumer_name: string;
  merchant_id: string | null;
  merchant_name: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  channel: string;
  partition_no: number;
  label: LabelRow | null;
}

export interface LabelRow {
  event_id: string;
  is_fraud: boolean;
  typology: string | null;
  actor_id: string | null;
  campaign_step: number | null;
  corruption_type: string | null;
  corruption_detail: string | null;
  sink: string | null;
  delivery_outcome: string | null;
}

const TRUTH_COLUMNS = [
  "event_id",
  "ts",
  "type",
  "status",
  "amount",
  "currency",
  "consumer_id",
  "consumer_name",
  "merchant_id",
  "merchant_name",
  "counterparty_id",
  "counterparty_name",
  "channel",
  "partition_no",
] as const;

const LABEL_COLUMNS = [
  "event_id",
  "is_fraud",
  "typology",
  "actor_id",
  "campaign_step",
  "corruption_type",
  "corruption_detail",
  "sink",
  "delivery_outcome",
] as const;

function shapeTruthRow(row: Record<string, unknown>): Omit<TruthEventRow, "label"> {
  const shaped: Record<string, unknown> = {};
  for (const col of TRUTH_COLUMNS) shaped[col] = row[`t_${col}`];
  return shaped as unknown as Omit<TruthEventRow, "label">;
}

function shapeLabelRow(row: Record<string, unknown>): LabelRow | null {
  if (row.l_event_id == null) return null;
  const shaped: Record<string, unknown> = {};
  for (const col of LABEL_COLUMNS) shaped[col] = row[`l_${col}`];
  return shaped as unknown as LabelRow;
}

interface TruthEventFilters {
  typology: string | undefined;
  actorId: string | undefined;
  status: string | undefined;
  cursor: string | undefined;
  limit: number;
}

/** GET /runs/:id/truth/events, pushed down to DuckDB (FR-036 §5): filters, the
 * event_id sort, the cursor (`event_id > cursor`) and the page limit all run
 * inside the query instead of over a fully materialized JS array. */
export async function queryTruthEvents(
  dataDir: string,
  runId: string,
  filters: TruthEventFilters,
): Promise<{ events: TruthEventRow[]; nextCursor: string | null }> {
  const runDir = path.join(dataDir, "runs", runId);
  const truthDir = path.join(runDir, "truth");
  const labelsDir = path.join(runDir, "labels");
  if (!(await hasParquetFiles(truthDir))) return { events: [], nextCursor: null };

  const hasLabels = await hasParquetFiles(labelsDir);
  const truthGlob = sqlString(path.join(truthDir, "*.parquet"));
  const labelsGlob = sqlString(path.join(labelsDir, "*.parquet"));

  const truthSelect = TRUTH_COLUMNS.map((c) => `t.${c} AS t_${c}`).join(", ");
  const labelSelect = LABEL_COLUMNS.map((c) => `l.${c} AS l_${c}`).join(", ");

  const conditions: string[] = [];
  const params: Record<string, string> = {};
  if (filters.status) {
    conditions.push("t.status = $status");
    params.status = filters.status;
  }
  if (filters.typology) {
    conditions.push("l.typology = $typology");
    params.typology = filters.typology;
  }
  if (filters.actorId) {
    conditions.push("l.actor_id = $actorId");
    params.actorId = filters.actorId;
  }
  if (filters.cursor) {
    conditions.push("t.event_id > $cursor");
    params.cursor = filters.cursor;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  // Bound server-side (route handler clamps it), not bind-parameterized: LIMIT needs an
  // integer literal and this avoids any ambiguity from JS-number-to-SQL-type inference.
  const limit = Math.max(1, Math.min(1000, Math.trunc(filters.limit)));

  const sql = hasLabels
    ? `SELECT ${truthSelect}, ${labelSelect}
       FROM read_parquet(${truthGlob}) t
       LEFT JOIN (SELECT * FROM read_parquet(${labelsGlob}) WHERE corruption_type IS NULL) l
         ON t.event_id = l.event_id
       ${where}
       ORDER BY t.event_id ASC
       LIMIT ${limit}`
    : `SELECT ${truthSelect}
       FROM read_parquet(${truthGlob}) t
       ${where}
       ORDER BY t.event_id ASC
       LIMIT ${limit}`;

  const rows = await withConnection(async (connection) => {
    const reader = await connection.runAndReadAll(sql, params);
    return reader.getRowObjectsJS() as Record<string, unknown>[];
  });

  const events: TruthEventRow[] = rows.map((row) => ({
    ...shapeTruthRow(row),
    label: hasLabels ? shapeLabelRow(row) : null,
  }));
  const last = events.at(-1);
  return {
    events,
    nextCursor: events.length === limit && last ? last.event_id : null,
  };
}

export interface ActorStoryStep {
  campaign_step: number | null;
  event: Omit<TruthEventRow, "label">;
}

/** GET /runs/:id/truth/actors/:actorId/story, pushed down to DuckDB (FR-036 §5):
 * the actor filter and the campaign_step/ts ordering both run in the query. */
export async function queryActorStory(
  dataDir: string,
  runId: string,
  actorId: string,
): Promise<{ typology: string | null; steps: ActorStoryStep[] } | null> {
  const runDir = path.join(dataDir, "runs", runId);
  const truthDir = path.join(runDir, "truth");
  const labelsDir = path.join(runDir, "labels");
  if (!(await hasParquetFiles(truthDir)) || !(await hasParquetFiles(labelsDir))) return null;

  const truthGlob = sqlString(path.join(truthDir, "*.parquet"));
  const labelsGlob = sqlString(path.join(labelsDir, "*.parquet"));
  const truthSelect = TRUTH_COLUMNS.map((c) => `t.${c} AS t_${c}`).join(", ");

  const sql = `SELECT ${truthSelect}, l.typology AS l_typology, l.campaign_step AS l_campaign_step
    FROM read_parquet(${truthGlob}) t
    JOIN (SELECT * FROM read_parquet(${labelsGlob}) WHERE corruption_type IS NULL) l
      ON t.event_id = l.event_id
    WHERE l.actor_id = $actorId
    ORDER BY l.campaign_step ASC, t.ts ASC`;

  const rows = await withConnection(async (connection) => {
    const reader = await connection.runAndReadAll(sql, { actorId });
    return reader.getRowObjectsJS() as Record<string, unknown>[];
  });
  if (rows.length === 0) return null;

  return {
    typology: (rows[0]!.l_typology as string | null) ?? null,
    steps: rows.map((row) => ({
      campaign_step: row.l_campaign_step as number | null,
      event: shapeTruthRow(row),
    })),
  };
}
