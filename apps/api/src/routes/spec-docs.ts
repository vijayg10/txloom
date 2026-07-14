import type { FastifyInstance } from "fastify";
import { buildAuthoringDocs } from "@txloom/agent-tools";

/** GET /spec/docs — agent authoring documentation (FR-009): annotated schema
 * reference, semantic-invariant catalog (error codes + remedies), worked
 * example specs per gallery template. The same response the get_authoring_docs
 * MCP tool returns. */
export default async function specDocsRoutes(app: FastifyInstance) {
  app.get("/spec/docs", async () => buildAuthoringDocs());
}
