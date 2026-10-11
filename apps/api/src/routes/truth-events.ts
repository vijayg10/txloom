import type { FastifyInstance } from "fastify";
import { queryTruthEvents } from "../services/truth-query.js";

/** GET /runs/:id/truth/events — filter/browse ground truth by typology, actor,
 * status, with cursor pagination (FR-036 §5). Filtering, sorting and the page
 * limit are pushed down to DuckDB over the run's Parquet segments instead of
 * materializing every row into JS objects per request. */
export default async function truthEventsRoutes(app: FastifyInstance) {
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.get("/runs/:id/truth/events", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as {
      typology?: string;
      actor_id?: string;
      status?: string;
      cursor?: string;
      limit?: string;
    };

    const { events, nextCursor } = await queryTruthEvents(dataDir, id, {
      typology: query.typology,
      actorId: query.actor_id,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : 100,
    });

    return { events, next_cursor: nextCursor };
  });
}
