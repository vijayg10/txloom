import type { FastifyInstance } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import { getDb } from "../db/knex.js";
import { RunRepository, type RunRow } from "../db/repositories/runs.js";
import { loadRunTruthEvents, loadRunLabels } from "../services/truth-store.js";
import { computeVolumeOverTime } from "../services/inspector/volume-over-time.js";
import { computeAmountDistributions } from "../services/inspector/amount-distributions.js";
import { computeFraudTimeline } from "../services/inspector/fraud-timeline.js";

async function buildComparisonSide(dataDir: string, run: RunRow) {
  const [events, labels] = await Promise.all([
    loadRunTruthEvents(dataDir, run.id),
    loadRunLabels(dataDir, run.id),
  ]);
  const spec = run.spec_snapshot as SimulationSpec;
  return {
    run,
    volume_over_time: computeVolumeOverTime(events, spec.seasonality),
    amount_distributions: computeAmountDistributions(events),
    fraud_timeline: computeFraudTimeline(events, labels),
  };
}

/** GET /runs/compare?a&b — side-by-side comparison payload (FR-036 §4). */
export default async function runCompareRoutes(app: FastifyInstance) {
  const db = getDb();
  const runs = new RunRepository(db);
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.get("/runs/compare", async (request, reply) => {
    const { a, b } = request.query as { a?: string; b?: string };
    if (!a || !b) {
      reply.status(400);
      return {
        error: {
          code: "bad_request",
          message: "Query params ?a and ?b (run ids) are both required",
        },
      };
    }

    const [runA, runB] = await Promise.all([runs.getById(a), runs.getById(b)]);
    if (!runA || !runB) {
      reply.status(404);
      return { error: { code: "not_found", message: "One or both runs not found" } };
    }

    const [sideA, sideB] = await Promise.all([
      buildComparisonSide(dataDir, runA),
      buildComparisonSide(dataDir, runB),
    ]);
    return { a: sideA, b: sideB };
  });
}
