import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import { getDb } from "../db/knex.js";
import { RunRepository } from "../db/repositories/runs.js";
import { getQueues } from "../services/queues.js";
import {
  requestExport,
  getExportManifest,
  writeExportManifest,
  ExportValidationError,
  type ExportFormat,
  type ExportSource,
} from "../services/export-service.js";

interface CreateExportBody {
  format: ExportFormat;
  include_labels?: boolean;
  acknowledged_warning?: boolean;
  source?: ExportSource;
}

const FORMATS = new Set<string>(["csv", "parquet", "json"]);

export default async function exportRoutes(app: FastifyInstance) {
  const dataDir = process.env.DATA_DIR ?? "./data";

  const runs = new RunRepository(getDb());

  /** POST returns `202` with a `queued` manifest; the `export-build` worker job builds the files
   * and moves the manifest through `running` to `completed` or `failed` (R19). */
  app.post("/runs/:id/exports", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as CreateExportBody;
    const run = await runs.getById(id);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    if (!FORMATS.has(body.format)) {
      reply.status(400);
      return {
        error: {
          code: "invalid_format",
          message: 'format must be one of "csv", "parquet", "json"',
        },
      };
    }
    try {
      const manifest = await requestExport(
        dataDir,
        id,
        run.spec_snapshot as SimulationSpec | undefined,
        {
          format: body.format,
          include_labels: body.include_labels ?? false,
          ...(body.acknowledged_warning !== undefined
            ? { acknowledged_warning: body.acknowledged_warning }
            : {}),
          ...(body.source ? { source: body.source } : {}),
        },
      );
      try {
        await getQueues().exportBuild.add(
          `export-${id}-${manifest.export_id}`,
          { runId: id, exportId: manifest.export_id, dataDir },
          { jobId: `export-${manifest.export_id}`, attempts: 1 },
        );
      } catch (error) {
        await writeExportManifest(dataDir, {
          ...manifest,
          status: "failed",
          error: `Could not queue the export: ${error instanceof Error ? error.message : String(error)}`,
        });
        throw error;
      }
      reply.status(202);
      return manifest;
    } catch (error) {
      if (error instanceof ExportValidationError) {
        reply.status(422);
        return { error: { code: "label_warning_required", message: error.message } };
      }
      throw error;
    }
  });

  app.get("/runs/:id/exports/:exportId", async (request, reply) => {
    const { id, exportId } = request.params as { id: string; exportId: string };
    const manifest = await getExportManifest(dataDir, id, exportId);
    if (!manifest) {
      reply.status(404);
      return { error: { code: "not_found", message: "Export not found" } };
    }
    return manifest;
  });

  app.get("/runs/:id/exports/:exportId/download", async (request, reply) => {
    const { id, exportId } = request.params as { id: string; exportId: string };
    const manifest = await getExportManifest(dataDir, id, exportId);
    if (!manifest) {
      reply.status(404);
      return { error: { code: "not_found", message: "Export not found" } };
    }
    if (manifest.status !== "completed") {
      reply.status(409);
      return {
        error: {
          code: "export_not_ready",
          message: `Export is "${manifest.status}"; the download is available once it is completed.`,
        },
      };
    }
    const filePath = path.join(dataDir, "runs", id, "exports", exportId, manifest.file_name);
    reply.type("application/octet-stream");
    return reply.send(createReadStream(filePath));
  });
}
