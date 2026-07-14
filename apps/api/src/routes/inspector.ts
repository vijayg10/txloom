import type { FastifyInstance } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import { getDb } from "../db/knex.js";
import { RunRepository } from "../db/repositories/runs.js";
import { loadRunTruthEvents, loadRunLabels } from "../services/truth-store.js";
import { computeVolumeOverTime } from "../services/inspector/volume-over-time.js";
import { computeAmountDistributions } from "../services/inspector/amount-distributions.js";
import { computePersonaHeatmap } from "../services/inspector/persona-heatmap.js";
import { computeFraudTimeline } from "../services/inspector/fraud-timeline.js";
import { computeImperfectionAudit } from "../services/inspector/imperfection-audit.js";

/** GET /runs/:id/inspector/* — the world-inspector aggregates (FR-036 §4). */
export default async function inspectorRoutes(app: FastifyInstance) {
  const db = getDb();
  const runs = new RunRepository(db);
  const dataDir = process.env.DATA_DIR ?? "./data";

  async function requireRun(id: string) {
    const run = await runs.getById(id);
    if (!run) return null;
    return run;
  }

  app.get("/runs/:id/inspector/volume-over-time", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await requireRun(id);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    const events = await loadRunTruthEvents(dataDir, id);
    const spec = run.spec_snapshot as SimulationSpec;
    return computeVolumeOverTime(events, spec.seasonality);
  });

  app.get("/runs/:id/inspector/amount-distributions", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireRun(id))) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    return { buckets: computeAmountDistributions(await loadRunTruthEvents(dataDir, id)) };
  });

  app.get("/runs/:id/inspector/persona-heatmap", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireRun(id))) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    return { cells: computePersonaHeatmap(await loadRunTruthEvents(dataDir, id)) };
  });

  app.get("/runs/:id/inspector/fraud-timeline", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireRun(id))) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    const [events, labels] = await Promise.all([
      loadRunTruthEvents(dataDir, id),
      loadRunLabels(dataDir, id),
    ]);
    return { points: computeFraudTimeline(events, labels) };
  });

  app.get("/runs/:id/inspector/imperfection-audit", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireRun(id))) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    return { rows: computeImperfectionAudit(await loadRunLabels(dataDir, id)) };
  });
}
