import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { schema } from "@txloom/spec";

/** Registers the SimulationSpec JSON Schema 2020-12 document with Fastify's Ajv
 * instance so routes can validate request bodies against it by $ref (D12). */
export default fp(async function ajvPlugin(app: FastifyInstance) {
  app.addSchema({ ...schema, $id: "simulation-spec" });
});
