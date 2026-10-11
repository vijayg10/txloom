import type { FastifyInstance } from "fastify";
import { queryActorStory } from "../services/truth-query.js";

/**
 * GET /runs/:id/truth/actors/:actorId/story — the ordered `campaign_step`
 * sequence for one fraud actor (FR-036 §5): e.g. account_takeover's
 * dormancy → credential-change → drain script, or a card_testing burst.
 * Pushed down to DuckDB (same as truth-events.ts) instead of scanning the
 * run's full Parquet segments per request.
 */
export default async function actorStoryRoutes(app: FastifyInstance) {
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.get("/runs/:id/truth/actors/:actorId/story", async (request, reply) => {
    const { id, actorId } = request.params as { id: string; actorId: string };
    const story = await queryActorStory(dataDir, id, actorId);

    if (!story) {
      reply.status(404);
      return { error: { code: "not_found", message: `No campaign found for actor "${actorId}"` } };
    }

    return {
      actor_id: actorId,
      typology: story.typology,
      steps: story.steps,
    };
  });
}
