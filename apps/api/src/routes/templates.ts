import type { FastifyInstance } from "fastify";
import { getDb } from "../db/knex.js";

/** GET /templates — the gallery list (FR-006). Templates are seeded by a
 * read-only migration in User Story 6; this route is real and DB-backed from
 * US2 onward so list_templates (the MCP tool) has a genuine 1:1 REST mapping
 * even before the gallery is seeded. */
export default async function templatesRoutes(app: FastifyInstance) {
  app.get("/templates", async () => {
    const templates = await getDb()("templates").select(
      "slug",
      "name",
      "description",
      "spec",
      "benchmark_refs",
    );
    return { templates };
  });
}
