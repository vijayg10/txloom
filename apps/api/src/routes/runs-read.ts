import type { FastifyInstance } from "fastify";
import { getDb } from "../db/knex.js";
import { RunRepository, RunPartitionRepository } from "../db/repositories/runs.js";

export default async function runsReadRoutes(app: FastifyInstance) {
  const db = getDb();
  const runs = new RunRepository(db);
  const runPartitions = new RunPartitionRepository(db);

  app.get("/runs", async (request) => {
    const { limit, cursor } = request.query as { limit?: string; cursor?: string };
    return { runs: await runs.list(limit ? Number(limit) : undefined, cursor) };
  });

  app.get("/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await runs.getById(id);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    return run;
  });

  // v1: per-partition state rows double as a coarse log surface until a
  // dedicated log store exists.
  app.get("/runs/:id/logs", async (request) => {
    const { id } = request.params as { id: string };
    return { logs: await runPartitions.listByRun(id) };
  });
}
