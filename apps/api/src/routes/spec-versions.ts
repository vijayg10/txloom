import type { FastifyInstance } from "fastify";
import { validateSpec } from "@txloom/spec";
import { getDb } from "../db/knex.js";
import { SpecVersionRepository } from "../db/repositories/spec-versions.js";
import { ScenarioRepository } from "../db/repositories/scenarios.js";
import { checkStoredSpec } from "../services/spec-guard.js";

/** All spec mutations go through validate-then-save-as-new-version — every
 * mutation lands as a new, reviewable, rollbackable version-history entry,
 * never silent regeneration (constitution Principle IV, FR-005). */
export default async function specVersionRoutes(app: FastifyInstance) {
  const db = getDb();
  const versions = new SpecVersionRepository(db);
  const scenarios = new ScenarioRepository(db);

  app.get("/scenarios/:id/versions", async (request) => {
    const { id } = request.params as { id: string };
    return { versions: await versions.listByScenario(id) };
  });

  app.post("/scenarios/:id/versions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { spec: unknown };
    const result = validateSpec(body.spec);
    if (!result.valid) {
      reply.status(422);
      return {
        error: {
          code: "spec_invalid",
          message: "Spec failed validation",
          details: { violations: result.violations },
        },
      };
    }
    const version = await versions.create({
      scenario_id: id,
      spec: body.spec,
      author_type: "user",
    });
    await scenarios.setCurrentVersion(id, version.id);
    reply.status(201);
    return version;
  });

  app.post("/scenarios/:id/versions/:versionId/rollback", async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
    const target = await versions.getById(versionId);
    if (!target || target.scenario_id !== id) {
      reply.status(404);
      return { error: { code: "not_found", message: `Version "${versionId}" not found` } };
    }
    const invalid = checkStoredSpec(`Version ${target.version_no}`, target.spec);
    if (invalid) {
      reply.status(400);
      return invalid;
    }
    const version = await versions.rollback(id, versionId);
    await scenarios.setCurrentVersion(id, version.id);
    return version;
  });
}
