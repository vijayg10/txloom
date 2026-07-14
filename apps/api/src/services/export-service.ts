import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { ulid } from "ulid";
import {
  writeCsv,
  writeJson,
  writeParquet,
  readParquet,
  TRUTH_EVENT_SCHEMA,
  LABEL_RECORD_SCHEMA,
} from "@txloom/sinks";

export type ExportFormat = "csv" | "parquet" | "json";

export interface ExportRequest {
  format: ExportFormat;
  include_labels: boolean;
  acknowledged_warning?: boolean;
}

export interface ExportManifest {
  export_id: string;
  run_id: string;
  format: ExportFormat;
  include_labels: boolean;
  status: "completed";
  created_at: string;
  file_name: string;
  /** Always a distinct file from the main export, never merged, unless
   * include_labels is true (FR-021). */
  answer_key_file_name: string | null;
}

export class ExportValidationError extends Error {}

async function listParquetFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".parquet"));
  } catch {
    return [];
  }
}

async function* readAllParquet(
  dir: string,
  files: string[],
): AsyncGenerator<Record<string, unknown>> {
  for (const file of files) {
    yield* readParquet(path.join(dir, file));
  }
}

async function writeRows(
  filePath: string,
  format: ExportFormat,
  rows: AsyncGenerator<Record<string, unknown>>,
  schema: Record<string, unknown>,
): Promise<void> {
  if (format === "csv") await writeCsv(filePath, rows);
  else if (format === "json") await writeJson(filePath, rows);
  else await writeParquet(filePath, schema as Parameters<typeof writeParquet>[1], rows);
}

/**
 * POST /runs/:id/exports business logic — label export defaults to a
 * separate answer-key file; `include_labels:true` requires an explicit
 * `acknowledged_warning:true` or the request is rejected (FR-021/022).
 */
export async function createExport(
  dataDir: string,
  runId: string,
  request: ExportRequest,
): Promise<ExportManifest> {
  if (request.include_labels && !request.acknowledged_warning) {
    throw new ExportValidationError(
      "include_labels:true requires acknowledged_warning:true — labels are excluded from exports by default (FR-021/022)",
    );
  }

  const exportId = ulid();
  const exportDir = path.join(dataDir, "runs", runId, "exports", exportId);
  await mkdir(exportDir, { recursive: true });

  const truthDir = path.join(dataDir, "runs", runId, "truth");
  const labelsDir = path.join(dataDir, "runs", runId, "labels");
  const truthFiles = await listParquetFiles(truthDir);

  let labelsByEventId: Map<string, Record<string, unknown>> | null = null;
  if (request.include_labels) {
    labelsByEventId = new Map();
    for await (const row of readAllParquet(labelsDir, await listParquetFiles(labelsDir))) {
      if (row.corruption_type == null) labelsByEventId.set(row.event_id as string, row);
    }
  }

  async function* mainRows(): AsyncGenerator<Record<string, unknown>> {
    for await (const row of readAllParquet(truthDir, truthFiles)) {
      if (labelsByEventId) {
        const label = labelsByEventId.get(row.event_id as string);
        yield { ...row, is_fraud: label?.is_fraud ?? false, typology: label?.typology ?? null };
      } else {
        yield row;
      }
    }
  }

  const fileName = `data.${request.format}`;
  await writeRows(path.join(exportDir, fileName), request.format, mainRows(), TRUTH_EVENT_SCHEMA);

  let answerKeyFileName: string | null = null;
  if (!request.include_labels) {
    answerKeyFileName = `labels.${request.format}`;
    const labelFiles = await listParquetFiles(labelsDir);
    await writeRows(
      path.join(exportDir, answerKeyFileName),
      request.format,
      readAllParquet(labelsDir, labelFiles),
      LABEL_RECORD_SCHEMA,
    );
  }

  const manifest: ExportManifest = {
    export_id: exportId,
    run_id: runId,
    format: request.format,
    include_labels: request.include_labels,
    status: "completed",
    created_at: new Date().toISOString(),
    file_name: fileName,
    answer_key_file_name: answerKeyFileName,
  };
  await writeFile(path.join(exportDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function getExportManifest(
  dataDir: string,
  runId: string,
  exportId: string,
): Promise<ExportManifest | null> {
  try {
    const content = await readFile(
      path.join(dataDir, "runs", runId, "exports", exportId, "manifest.json"),
      "utf-8",
    );
    return JSON.parse(content) as ExportManifest;
  } catch {
    return null;
  }
}
