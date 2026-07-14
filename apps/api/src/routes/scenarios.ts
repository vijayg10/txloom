import type { FastifyInstance } from "fastify";
import { getDb } from "../db/knex.js";
import { ScenarioRepository } from "../db/repositories/scenarios.js";

export default async function scenarioRoutes(app: FastifyInstance) {
  const repo = new ScenarioRepository(getDb());

  app.get("/scenarios", async (request) => {
    const { limit, cursor } = request.query as { limit?: string; cursor?: string };
    return { scenarios: await repo.list(limit ? Number(limit) : undefined, cursor) };
  });

  app.post("/scenarios", async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      currency: string;
      template_slug?: string;
    };
    const scenario = await repo.create(body);
    reply.status(201);
    return scenario;
  });

  app.get("/scenarios/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scenario = await repo.getById(id);
    if (!scenario) {
      reply.status(404);
      return { error: { code: "not_found", message: `Scenario "${id}" not found` } };
    }
    return scenario;
  });

  app.patch("/scenarios/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string };
    await repo.update(id, body);
    return repo.getById(id);
  });

  app.delete("/scenarios/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await repo.delete(id);
    reply.status(204);
  });
}
