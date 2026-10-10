import type { FastifyInstance } from "fastify";
import type { SimulationSpec } from "@txloom/spec";
import { getDb } from "../db/knex.js";
import { ScenarioRepository } from "../db/repositories/scenarios.js";
import { SpecVersionRepository } from "../db/repositories/spec-versions.js";
import { DestinationDefaultsRepository } from "../db/repositories/destination-defaults.js";
import { LaunchDefaultsRepository } from "../db/repositories/launch-defaults.js";
import { ConnectionRepository } from "../db/repositories/connections.js";
import { checkStoredSpec } from "../services/spec-guard.js";
import { InvalidSeedError, parseSeed } from "../services/seed.js";
import { launchGeneration } from "../services/run-launch-service.js";
import {
  validateDestinations,
  snapshotDestinations,
  type DestinationInput,
} from "../services/destinations.js";

interface LaunchRunBody {
  seed?: string | number;
  sink_connection_ids?: string[];
  mode?: "batch" | "batch_then_stream" | "history_only" | "history_then_live";
  label_export?: "separate_export" | "merged_with_warning";
  stream_label_channel?: boolean;
  destinations?: DestinationInput[];
  /** Send the whole history to the broker destinations once generation finishes (FR-021). */
  replay_history?: boolean;
}

// Old clients still send `batch` / `batch_then_stream`; map them onto the new
// enum and flag the response as deprecated (data-model.md §1.2).
const LEGACY_MODE_MAP: Record<string, "history_only" | "history_then_live"> = {
  batch: "history_only",
  batch_then_stream: "history_then_live",
};

/** POST /scenarios/:id/runs — snapshots the scenario's current spec verbatim
 * (the immutable run record, FR-033) and enqueues one generate-partition job
 * per partition; the worker pool drives generation via piscina (T094). */
export default async function runsLaunchRoutes(app: FastifyInstance) {
  const db = getDb();
  const dataDir = process.env.DATA_DIR ?? "./data";
  const scenarios = new ScenarioRepository(db);
  const specVersions = new SpecVersionRepository(db);
  const destinationDefaults = new DestinationDefaultsRepository(db);
  const launchDefaults = new LaunchDefaultsRepository(db);
  const connections = new ConnectionRepository(db, dataDir);

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

    const invalid = checkStoredSpec(`Version ${version.version_no}`, version.spec);
    if (invalid) {
      reply.status(400);
      return invalid;
    }

    const spec = version.spec as SimulationSpec;
    let seed: bigint;
    try {
      seed = parseSeed(body.seed ?? spec.seed);
    } catch (error) {
      if (!(error instanceof InvalidSeedError)) throw error;
      reply.status(400);
      return { error: { code: error.code, message: error.message, details: { path: error.path } } };
    }
    const requestedMode = body.mode ?? "history_only";
    const legacyMode = LEGACY_MODE_MAP[requestedMode];
    const mode = legacyMode ?? (requestedMode as "history_only" | "history_then_live");
    if (legacyMode || body.sink_connection_ids !== undefined) reply.header("Deprecation", "true");

    const destinationInputs = body.destinations ?? [];
    const allConnections = await connections.list();
    const validationError = validateDestinations(spec, destinationInputs, allConnections);
    if (validationError) {
      reply.status(400);
      return {
        error: {
          code: validationError.code,
          message: validationError.message,
          details: validationError.details,
        },
      };
    }
    const resolvedDestinations = snapshotDestinations(destinationInputs, allConnections);

    const run = await launchGeneration(db, dataDir, {
      scenario_id: id,
      spec_version_id: version.id,
      spec,
      seed,
      params: {
        label_export: body.label_export ?? "separate_export",
        stream_label_channel: body.stream_label_channel ?? false,
      },
      mode,
      destinations: resolvedDestinations,
      replay_history: body.replay_history === true,
    });

    if (destinationInputs.length > 0) {
      await destinationDefaults.upsertAll(
        id,
        destinationInputs.map((d) => ({
          sink_name: d.sink,
          connection_id: d.connection_id,
          ...(d.topic ? { topic: d.topic } : {}),
          ...(d.routing_key ? { routing_key: d.routing_key } : {}),
          ...(d.label_topic ? { label_topic: d.label_topic } : {}),
        })),
      );
    }

    reply.status(201);
    return run;
  });

  app.get("/scenarios/:id/launch-defaults", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scenario = await scenarios.getById(id);
    if (!scenario?.current_version_id) {
      reply.status(404);
      return { error: { code: "not_found", message: `Scenario "${id}" not found` } };
    }
    const version = await specVersions.getById(scenario.current_version_id);
    const spec = version?.spec as SimulationSpec | undefined;
    const currentSinkNames = new Set((spec?.output.sinks ?? []).map((s) => s.name));

    const [defaultRows, allConnections, launch] = await Promise.all([
      destinationDefaults.listByScenario(id),
      connections.list(),
      launchDefaults.getByScenario(id),
    ]);
    const byConnectionId = new Map(allConnections.map((c) => [c.id, c]));

    const destinations = defaultRows
      .filter((row) => currentSinkNames.has(row.sink_name))
      .map((row) => {
        const connection = row.connection_id ? byConnectionId.get(row.connection_id) : undefined;
        return {
          sink: row.sink_name,
          connection_id: row.connection_id ?? "",
          connection_name: connection?.name ?? "",
          connection_type: connection?.type ?? "",
          connection_missing: !connection,
          ...(row.topic ? { topic: row.topic } : {}),
          ...(row.routing_key ? { routing_key: row.routing_key } : {}),
          ...(row.label_topic ? { label_topic: row.label_topic } : {}),
        };
      });

    return {
      destinations,
      mode: launch?.mode ?? "history_only",
      target_tps: launch?.target_tps ?? null,
      replay_history: launch?.replay_history ?? false,
      label_channel: launch?.label_channel ?? false,
    };
  });
}
