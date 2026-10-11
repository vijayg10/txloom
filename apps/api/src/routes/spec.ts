import { availableParallelism } from "node:os";
import type { FastifyInstance } from "fastify";
import { schema, validateSpec, type SimulationSpec } from "@txloom/spec";
import { estimateRun } from "@txloom/engine";
import { getDb } from "../db/knex.js";
import { specInvalidError } from "../services/spec-guard.js";

/** Events per second one generation thread produced in the review's measurement; replaced by the
 * worker's own measurement after each completed run (`settings.generation_throughput`). */
const DEFAULT_THROUGHPUT_PER_THREAD = 150_000;

async function storedThroughput(useDb: boolean): Promise<number> {
  if (!useDb) return DEFAULT_THROUGHPUT_PER_THREAD;
  try {
    const row = await getDb()("settings").where({ key: "generation_throughput" }).first();
    const value = Number(row?.value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_THROUGHPUT_PER_THREAD;
  } catch {
    // No database (or no settings table yet): the estimate still has a sensible default.
    return DEFAULT_THROUGHPUT_PER_THREAD;
  }
}

/** The worker pool's size, as the worker computes it (`TXLOOM_MAX_WORKER_THREADS`, else one fewer
 * than the CPUs). Both containers share a host, so this approximates the worker's pool. */
function generationThreads(): number {
  const configured = Number(process.env.TXLOOM_MAX_WORKER_THREADS ?? "");
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return Math.max(1, availableParallelism() - 1);
}

/** POST /spec/validate: side-effect-free, never 4xx for invalid specs — the
 * response body itself carries the located violations (FR-004/010, D12).
 * POST /spec/estimate: closed-form volume and duration for a spec (FR-045); side-effect-free.
 * GET /spec/schema: same JSON Schema the editor and agents author against. */
export default async function specRoutes(app: FastifyInstance, options: { useDb?: boolean } = {}) {
  const useDb = options.useDb ?? true;
  app.post("/spec/validate", async (request) => {
    return validateSpec(request.body);
  });

  app.post("/spec/estimate", async (request, reply) => {
    const body = (request.body ?? {}) as { spec?: unknown; replay_history?: boolean };
    const validation = validateSpec(body.spec);
    if (!validation.valid) {
      reply.status(400);
      return specInvalidError("The spec", validation);
    }
    return estimateRun(body.spec as SimulationSpec, {
      replayHistory: body.replay_history === true,
      throughputPerThread: await storedThroughput(useDb),
      threads: generationThreads(),
    });
  });

  app.get("/spec/schema", async () => schema);
}
