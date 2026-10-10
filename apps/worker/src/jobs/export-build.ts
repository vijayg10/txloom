import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  DELIVERED_EVENT_SCHEMA,
  LABEL_RECORD_SCHEMA,
  TRUTH_EVENT_SCHEMA,
  listPartSegments,
  readParquet,
  writeCsv,
  writeJson,
  writeParquet,
} from "@txloom/sinks";
import {
  exportDir,
  getExportManifest,
  writeExportManifest,
  type ExportFormat,
  type ExportManifest,
} from "../../../api/src/services/export-service.js";

export interface ExportBuildJobData {
  runId: string;
  exportId: string;
  dataDir: string;
}

type Row = Record<string, unknown>;
type Schema = Record<string, unknown>;

/** Every column of `schema` in schema order, `null` where a row has no value — Parquet readers
 * leave optional columns out, and a CSV header is taken from the first row. */
function shape(row: Row, columns: readonly string[]): Row {
  const out: Row = {};
  for (const column of columns) out[column] = row[column] ?? null;
  return out;
}

async function* segmentRows(files: readonly string[]): AsyncGenerator<Row> {
  for (const file of files) yield* readParquet(file);
}

/** Rows of two aligned segment lists in lockstep: row i of `labels` is the label of row i of
 * `data` (data-model.md §3). Only one row of each is ever in memory. */
async function* zipAligned(
  data: readonly string[],
  labels: readonly string[],
): AsyncGenerator<{ row: Row; label: Row | undefined }> {
  const labelRows = segmentRows(labels)[Symbol.asyncIterator]();
  for await (const row of segmentRows(data)) {
    const next = await labelRows.next();
    yield { row, label: next.done ? undefined : next.value };
  }
  await labelRows.return?.(undefined);
}

async function writeRows(
  filePath: string,
  format: ExportFormat,
  rows: AsyncGenerator<Row>,
  schema: Schema,
): Promise<void> {
  if (format === "csv") await writeCsv(filePath, rows);
  else if (format === "json") await writeJson(filePath, rows);
  else await writeParquet(filePath, schema as Parameters<typeof writeParquet>[1], rows);
}

/** A sink's `corruptions/<sink>/` or `deliveries/<sink>/` Parquet files. */
async function listAll(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((name) => name.endsWith(".parquet"))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

const LABEL_COLUMNS = Object.keys(LABEL_RECORD_SCHEMA);
/** What `include_labels` merges onto each row: every answer-key column except the row's own
 * `event_id` and the sink bookkeeping. */
const MERGED_LABEL_COLUMNS = LABEL_COLUMNS.filter((c) => c !== "event_id" && c !== "sink");

/**
 * Builds one export (R19): the main data file for the chosen source, plus either the answer-key
 * file or, with `include_labels`, the labels merged onto each row.
 *
 * - **truth**: `truth/` rows; the answer key is `labels/`.
 * - **sink**: the sink's delivered copy `delivered/<sink>/`; the answer key is `labels/` plus
 *   that sink's `corruptions/` and `deliveries/…/dropped-*` rows, so every imperfection and every
 *   failed delivery is enumerated (SC-004).
 *
 * Everything streams, so memory stays flat however large the run is.
 */
export async function buildExport(manifest: ExportManifest, dataDir: string): Promise<void> {
  const runDir = path.join(dataDir, "runs", manifest.run_id);
  const outDir = exportDir(dataDir, manifest.run_id, manifest.export_id);
  await mkdir(outDir, { recursive: true });

  const { source } = manifest;
  let dataFiles: string[];
  let alignedLabelFiles: string[];
  let columns: string[];
  let schema: Schema;
  let answerKeyFiles: string[];

  const truthLabels = await listPartSegments(path.join(runDir, "labels"));
  if (source.kind === "truth") {
    dataFiles = await listPartSegments(path.join(runDir, "truth"));
    alignedLabelFiles = truthLabels;
    columns = Object.keys(TRUTH_EVENT_SCHEMA);
    schema = TRUTH_EVENT_SCHEMA;
    answerKeyFiles = truthLabels;
  } else {
    const sinkDir = path.join(runDir, "delivered", source.name);
    dataFiles = await listPartSegments(sinkDir);
    if (dataFiles.length === 0) {
      throw new Error(
        `Run "${manifest.run_id}" has no delivered output for sink "${source.name}". Export from "truth" or from a file sink that exists in this run.`,
      );
    }
    // Fraud labels aligned 1:1 with the delivered rows (duplicates carry their event's label).
    alignedLabelFiles = (await listAll(sinkDir)).filter((f) =>
      path.basename(f).startsWith("labels-part-"),
    );
    columns = Object.keys(DELIVERED_EVENT_SCHEMA);
    schema = DELIVERED_EVENT_SCHEMA;
    answerKeyFiles = [
      ...truthLabels,
      ...(await listAll(path.join(runDir, "corruptions", source.name))),
      ...(await listAll(path.join(runDir, "deliveries", source.name))),
    ];
  }

  async function* mainRows(): AsyncGenerator<Row> {
    if (!manifest.include_labels) {
      for await (const row of segmentRows(dataFiles)) yield shape(row, columns);
      return;
    }
    for await (const { row, label } of zipAligned(dataFiles, alignedLabelFiles)) {
      const merged = shape(row, columns);
      for (const column of MERGED_LABEL_COLUMNS) merged[column] = label?.[column] ?? null;
      yield merged;
    }
  }

  const mergedSchema: Schema = manifest.include_labels
    ? {
        ...schema,
        ...Object.fromEntries(
          MERGED_LABEL_COLUMNS.map((c) => [
            c,
            { ...(LABEL_RECORD_SCHEMA[c] as object), optional: true },
          ]),
        ),
      }
    : schema;
  await writeRows(path.join(outDir, manifest.file_name), manifest.format, mainRows(), mergedSchema);

  if (!manifest.include_labels && manifest.answer_key_file_name) {
    async function* answerKeyRows(): AsyncGenerator<Row> {
      for await (const row of segmentRows(answerKeyFiles)) yield shape(row, LABEL_COLUMNS);
    }
    await writeRows(
      path.join(outDir, manifest.answer_key_file_name),
      manifest.format,
      answerKeyRows(),
      LABEL_RECORD_SCHEMA,
    );
  }
}

/** Moves the manifest `queued → running → completed | failed` around `buildExport`. */
export async function runExportBuild(data: ExportBuildJobData): Promise<void> {
  const manifest = await getExportManifest(data.dataDir, data.runId, data.exportId);
  if (!manifest) throw new Error(`Export ${data.exportId} has no manifest`);
  await writeExportManifest(data.dataDir, { ...manifest, status: "running" });
  try {
    await buildExport(manifest, data.dataDir);
    await writeExportManifest(data.dataDir, {
      ...manifest,
      status: "completed",
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    await writeExportManifest(data.dataDir, {
      ...manifest,
      status: "failed",
      finished_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface ExportBuildDeps {
  connection: ConnectionOptions;
}

/** `export-build` BullMQ job: builds an export off the API's event loop. */
export function startExportBuildWorker(deps: ExportBuildDeps): Worker<ExportBuildJobData> {
  return new Worker<ExportBuildJobData>(
    "export-build",
    async (job: Job<ExportBuildJobData>) => runExportBuild(job.data),
    { connection: deps.connection, concurrency: Number(process.env.TXLOOM_MAX_EXPORTS) || 2 },
  );
}
