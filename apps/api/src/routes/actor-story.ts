import type { FastifyInstance } from "fastify";
import { loadRunTruthAndLabels } from "./truth-events.js";

/**
 * GET /runs/:id/truth/actors/:actorId/story — the ordered `campaign_step`
 * sequence for one fraud actor (FR-036 §5): e.g. account_takeover's
 * dormancy → credential-change → drain script, or a card_testing burst.
 * Reuses truth-events.ts's Parquet-scan helper (v1 scope: no query-optimized
 * truth index yet, same documented follow-up as the truth/events route).
 */
export default async function actorStoryRoutes(app: FastifyInstance) {
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.get("/runs/:id/truth/actors/:actorId/story", async (request, reply) => {
    const { id, actorId } = request.params as { id: string; actorId: string };
    const { events, labelsByEventId } = await loadRunTruthAndLabels(dataDir, id);

    const steps = events
      .map((event) => ({ event, label: labelsByEventId.get(event.event_id as string) ?? null }))
      .filter((row) => row.label?.actor_id === actorId)
      .sort((a, b) => {
        const stepA = (a.label!.campaign_step as number | null) ?? 0;
        const stepB = (b.label!.campaign_step as number | null) ?? 0;
        if (stepA !== stepB) return stepA - stepB;
        return String(a.event.ts).localeCompare(String(b.event.ts));
      });

    if (steps.length === 0) {
      reply.status(404);
      return { error: { code: "not_found", message: `No campaign found for actor "${actorId}"` } };
    }

    return {
      actor_id: actorId,
      typology: steps[0]!.label!.typology,
      steps: steps.map((row) => ({
        campaign_step: row.label!.campaign_step,
        event: row.event,
      })),
    };
  });
}
