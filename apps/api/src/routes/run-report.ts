import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

export default async function runReportRoutes(app: FastifyInstance) {
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.get("/runs/:id/report", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const content = await readFile(path.join(dataDir, "runs", id, "report.json"), "utf-8");
      return JSON.parse(content);
    } catch {
      reply.status(404);
      return {
        error: { code: "not_found", message: "Realism report not available yet for this run" },
      };
    }
  });
}
