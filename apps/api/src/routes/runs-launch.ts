import type { FastifyInstance } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import { getDb } from "../db/knex.js";
import { ScenarioRepository } from "../db/repositories/scenarios.js";
import { SpecVersionRepository } from "../db/repositories/spec-versions.js";
import { RunRepository, RunPartitionRepository } from "../db/repositories/runs.js";
import { launchGeneration } from "../services/run-launch-service.js";

interface LaunchRunBody {
  seed?: number;
  sink_connection_ids?: string[];
  mode?: "batch" | "batch_then_stream";
  label_export?: "separate_export" | "merged_with_warning";
  stream_label_channel?: boolean;
}

/** POST /scenarios/:id/runs — snapshots the scenario's current spec verbatim
 * (the immutable run record, FR-033) and enqueues one generate-partition job
 * per partition; the worker pool drives generation via piscina (T094). */
export default async function runsLaunchRoutes(app: FastifyInstance) {
  const db = getDb();
  const scenarios = new ScenarioRepository(db);
  const specVersions = new SpecVersionRepository(db);
  const runs = new RunRepository(db);
  const runPartitions = new RunPartitionRepository(db);
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.post("/scenarios/:id/runs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as LaunchRunBody;

    const scenario = await scenarios.getById(id);
    if (!scenario?.current_version_id) {
      reply.status(404);
      return {
        error: { code: "not_found", message: `Scenario "${id}" has no saved spec version to run` },
      };
    }
    const version = await specVersions.getById(scenario.current_version_id);
    if (!version) {
      reply.status(404);
      return { error: { code: "not_found", message: "Current spec version not found" } };
    }

    const spec = version.spec as SimulationSpec;
    const seed = BigInt(body.seed ?? Math.floor(Math.random() * 1_000_000_000));
    const mode = body.mode ?? "batch";

    const run = await launchGeneration(runs, runPartitions, dataDir, {
      scenario_id: id,
      spec_version_id: version.id,
      spec,
      seed,
      params: {
        sink_connection_ids: body.sink_connection_ids ?? [],
        label_export: body.label_export ?? "separate_export",
        stream_label_channel: body.stream_label_channel ?? false,
      },
      mode,
    });

    reply.status(201);
    return run;
  });
}
