import type { FastifyInstance } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import { getDb } from "../db/knex.js";
import { ScenarioRepository } from "../db/repositories/scenarios.js";
import { SpecVersionRepository } from "../db/repositories/spec-versions.js";

interface TemplateRow {
  slug: string;
  name: string;
  spec: unknown;
}

export default async function scenarioRoutes(app: FastifyInstance) {
  const db = getDb();
  const repo = new ScenarioRepository(db);
  const specVersions = new SpecVersionRepository(db);

  app.get("/scenarios", async (request) => {
    const { limit, cursor } = request.query as { limit?: string; cursor?: string };
    return { scenarios: await repo.list(limit ? Number(limit) : undefined, cursor) };
  });

  app.post("/scenarios", async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      currency?: string;
      template_slug?: string;
    };

    // Clone-into-scenario (FR-006): the template's spec becomes the new
    // scenario's first version, not just a provenance tag.
    if (body.template_slug) {
      const template = await db<TemplateRow>("templates")
        .where({ slug: body.template_slug })
        .first();
      if (!template) {
        reply.status(404);
        return {
          error: {
            code: "not_found",
            message: `Template "${body.template_slug}" not found`,
          },
        };
      }
      const spec = (
        typeof template.spec === "string" ? JSON.parse(template.spec) : template.spec
      ) as SimulationSpec;

      const scenario = await repo.create({
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        currency: body.currency ?? spec.currency,
        template_slug: body.template_slug,
      });
      const version = await specVersions.create({
        scenario_id: scenario.id,
        spec,
        author_type: "user",
      });
      await repo.setCurrentVersion(scenario.id, version.id);

      reply.status(201);
      return (await repo.getById(scenario.id))!;
    }

    if (!body.currency) {
      reply.status(400);
      return {
        error: { code: "missing_currency", message: "currency is required for a blank scenario" },
      };
    }
    const scenario = await repo.create({
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      currency: body.currency,
    });
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
