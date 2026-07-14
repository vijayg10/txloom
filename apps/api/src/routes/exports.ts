import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  createExport,
  getExportManifest,
  ExportValidationError,
  type ExportFormat,
} from "../services/export-service.js";

interface CreateExportBody {
  format: ExportFormat;
  include_labels?: boolean;
  acknowledged_warning?: boolean;
}

export default async function exportRoutes(app: FastifyInstance) {
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.post("/runs/:id/exports", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as CreateExportBody;
    try {
      const manifest = await createExport(dataDir, id, {
        format: body.format,
        include_labels: body.include_labels ?? false,
        ...(body.acknowledged_warning !== undefined
          ? { acknowledged_warning: body.acknowledged_warning }
          : {}),
      });
      reply.status(201);
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
    const filePath = path.join(dataDir, "runs", id, "exports", exportId, manifest.file_name);
    reply.type("application/octet-stream");
    return reply.send(createReadStream(filePath));
  });
}
