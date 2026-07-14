import type { FastifyInstance } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import { getDb } from "../db/knex.js";
import { RunRepository, RunPartitionRepository } from "../db/repositories/runs.js";
import { launchGeneration } from "../services/run-launch-service.js";

/** POST /runs/:id/regenerate — "exactly this dataset" (FR-033): launches a new
 * run from a stored run's spec snapshot + seed verbatim, byte-identical to the
 * original by construction (constitution Principle II). */
export default async function runRegenerateRoutes(app: FastifyInstance) {
  const db = getDb();
  const runs = new RunRepository(db);
  const runPartitions = new RunPartitionRepository(db);
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.post("/runs/:id/regenerate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = await runs.getById(id);
    if (!source) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }

    const run = await launchGeneration(runs, runPartitions, dataDir, {
      scenario_id: source.scenario_id,
      spec_version_id: source.spec_version_id,
      spec: source.spec_snapshot as SimulationSpec,
      seed: BigInt(source.seed),
      params: source.params,
      mode: source.mode,
    });

    reply.status(201);
    return run;
  });
}
