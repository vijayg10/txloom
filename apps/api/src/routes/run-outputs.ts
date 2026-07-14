import path from "node:path";
import { rm } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db/knex.js";
import { RunRepository } from "../db/repositories/runs.js";

/** DELETE /runs/:id/outputs — reclaims storage while keeping the MySQL row
 * (spec snapshot + seed) for one-click regeneration (FR-033a). */
export default async function runOutputsRoutes(app: FastifyInstance) {
  const db = getDb();
  const runs = new RunRepository(db);
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.delete("/runs/:id/outputs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await runs.getById(id);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }

    await rm(path.join(dataDir, "runs", id), { recursive: true, force: true });
    await runs.markOutputsDeleted(id);
    reply.status(204);
  });
}
