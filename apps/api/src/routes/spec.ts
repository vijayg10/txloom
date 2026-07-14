import type { FastifyInstance } from "fastify";
import { schema, validateSpec } from "@txloom/spec";

/** POST /spec/validate: side-effect-free, never 4xx for invalid specs — the
 * response body itself carries the located violations (FR-004/010, D12).
 * GET /spec/schema: same JSON Schema the editor and agents author against. */
export default async function specRoutes(app: FastifyInstance) {
  app.post("/spec/validate", async (request) => {
    return validateSpec(request.body);
  });

  app.get("/spec/schema", async () => schema);
}
