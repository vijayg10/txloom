import path from "node:path";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import type { RealismReport } from "@txloom/engine";
import { getDb } from "../db/knex.js";
import { RunRepository } from "../db/repositories/runs.js";
import {
  loadRunTruthEvents,
  loadRunLabels,
  loadRunCorruptionLabels,
} from "../services/truth-store.js";
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

  /** The merged realism report, if report-build has produced one for this run yet (D17).
   * Returns null rather than throwing — callers fall back to a direct truth-store scan,
   * which is the only option while a run is still generating. */
  async function readReport(id: string): Promise<RealismReport | null> {
    try {
      const content = await readFile(path.join(dataDir, "runs", id, "report.json"), "utf-8");
      return JSON.parse(content) as RealismReport;
    } catch {
      return null;
    }
  }

  app.get("/runs/:id/inspector/volume-over-time", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await requireRun(id);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    const spec = run.spec_snapshot as SimulationSpec;
    const report = await readReport(id);
    if (report) return { points: report.volume_over_time, seasonality: spec.seasonality };
    const events = await loadRunTruthEvents(dataDir, id);
    return computeVolumeOverTime(events, spec.seasonality);
  });

  app.get("/runs/:id/inspector/amount-distributions", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireRun(id))) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    const report = await readReport(id);
    if (report) return { buckets: report.amount_by_type };
    return { buckets: computeAmountDistributions(await loadRunTruthEvents(dataDir, id)) };
  });

  app.get("/runs/:id/inspector/persona-heatmap", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireRun(id))) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    const report = await readReport(id);
    if (report) return { cells: report.persona_heatmap };
    return { cells: computePersonaHeatmap(await loadRunTruthEvents(dataDir, id)) };
  });

  app.get("/runs/:id/inspector/fraud-timeline", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireRun(id))) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    const report = await readReport(id);
    if (report) return { points: report.fraud_timeline };
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
    return { rows: computeImperfectionAudit(await loadRunCorruptionLabels(dataDir, id)) };
  });
}
