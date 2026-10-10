import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { ulid } from "ulid";
import type { SimulationSpec } from "@txloom/spec";

export type ExportFormat = "csv" | "parquet" | "json";
export type ExportSource = { kind: "truth" } | { kind: "sink"; name: string };
export type ExportStatus = "queued" | "running" | "completed" | "failed";

export interface ExportRequest {
  format: ExportFormat;
  include_labels: boolean;
  acknowledged_warning?: boolean;
  source?: ExportSource;
}

export interface ExportManifest {
  export_id: string;
  run_id: string;
  format: ExportFormat;
  include_labels: boolean;
  source: ExportSource;
  status: ExportStatus;
  created_at: string;
  finished_at?: string;
  /** Set once `completed`. */
  file_name: string;
  /** Always a distinct file from the main export, never merged, unless
   * include_labels is true (FR-021). */
  answer_key_file_name: string | null;
  /** Set when `failed`. */
  error?: string;
}

export class ExportValidationError extends Error {}

/** The export source when the request names none (contracts/api.md): the first `file` sink the
 * spec declares, otherwise the truth store. */
export function defaultExportSource(
  spec: Pick<SimulationSpec, "output"> | undefined,
): ExportSource {
  const fileSink = spec?.output?.sinks?.find((sink) => sink.type === "file");
  return fileSink ? { kind: "sink", name: fileSink.name } : { kind: "truth" };
}

export function exportDir(dataDir: string, runId: string, exportId: string): string {
  return path.join(dataDir, "runs", runId, "exports", exportId);
}

/** Writes the manifest through a temporary file so a poller never reads half of it. */
export async function writeExportManifest(
  dataDir: string,
  manifest: ExportManifest,
): Promise<void> {
  const dir = exportDir(dataDir, manifest.run_id, manifest.export_id);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, "manifest.json");
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest, null, 2));
  await rename(temporary, target);
}

/**
 * POST /runs/:id/exports business logic (R19): validates the request and writes the `queued`
 * manifest. The files themselves are built by the `export-build` worker job, so a large export
 * never runs on the API's event loop (constitution Principle V). `include_labels:true` requires
 * an explicit `acknowledged_warning:true` or the request is rejected (FR-021/022).
 */
export async function requestExport(
  dataDir: string,
  runId: string,
  spec: Pick<SimulationSpec, "output"> | undefined,
  request: ExportRequest,
): Promise<ExportManifest> {
  if (request.include_labels && !request.acknowledged_warning) {
    throw new ExportValidationError(
      "include_labels:true requires acknowledged_warning:true — labels are excluded from exports by default (FR-021/022)",
    );
  }

  const source = request.source ?? defaultExportSource(spec);
  const manifest: ExportManifest = {
    export_id: ulid(),
    run_id: runId,
    format: request.format,
    include_labels: request.include_labels,
    source,
    status: "queued",
    created_at: new Date().toISOString(),
    file_name: `data.${request.format}`,
    answer_key_file_name: request.include_labels ? null : `labels.${request.format}`,
  };
  await writeExportManifest(dataDir, manifest);
  return manifest;
}

export async function getExportManifest(
  dataDir: string,
  runId: string,
  exportId: string,
): Promise<ExportManifest | null> {
  try {
    const content = await readFile(
      path.join(exportDir(dataDir, runId, exportId), "manifest.json"),
      "utf-8",
    );
    return JSON.parse(content) as ExportManifest;
  } catch {
    return null;
  }
}
