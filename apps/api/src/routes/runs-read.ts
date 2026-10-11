import type { FastifyInstance } from "fastify";
import { getDb } from "../db/knex.js";
import { RunDeliveryRepository, serializeDelivery } from "../db/repositories/run-deliveries.js";
import type { Knex } from "knex";
import { derivePhase } from "../ws/run-progress.js";
import { RunRepository, RunPartitionRepository, type RunRow } from "../db/repositories/runs.js";

/** The run as the API reports it (FR-050): its row, plus the scenario and spec version it names
 * and the destinations it was launched with. */
async function describeRuns(db: Knex, rows: RunRow[]) {
  const scenarioIds = [...new Set(rows.map((r) => r.scenario_id))];
  const versionIds = [...new Set(rows.map((r) => r.spec_version_id))];
  const scenarios = scenarioIds.length
    ? await db("scenarios").whereIn("id", scenarioIds).select("id", "name")
    : [];
  const versions = versionIds.length
    ? await db("spec_versions").whereIn("id", versionIds).select("id", "version_no")
    : [];
  const destinations = rows.length
    ? await db("run_destinations").whereIn(
        "run_id",
        rows.map((r) => r.id),
      )
    : [];
  const runIds = rows.map((r) => r.id);
  const deliveryStates = runIds.length
    ? await db("run_deliveries").whereIn("run_id", runIds).select("run_id", "state")
    : [];
  const streamStates = runIds.length
    ? await db("streams").whereIn("run_id", runIds).select("run_id", "state")
    : [];
  return rows.map((run) => ({
    ...run,
    phase: derivePhase(
      run.status,
      deliveryStates.filter((d) => d.run_id === run.id) as { state: string }[],
      streamStates.find((s) => s.run_id === run.id)?.state as string | undefined,
    ),
    scenario: {
      id: run.scenario_id,
      name: scenarios.find((s) => s.id === run.scenario_id)?.name ?? "",
    },
    spec_version: {
      id: run.spec_version_id,
      number: Number(versions.find((v) => v.id === run.spec_version_id)?.version_no ?? 0),
    },
    launch_destinations: destinations
      .filter((d) => d.run_id === run.id)
      .map((d) => ({
        sink: d.sink_name as string,
        connection_id: (d.connection_id as string | null) ?? "",
        connection_name: d.connection_name as string,
        connection_type: d.connection_type as string,
        connection_missing: d.connection_id === null,
        ...(d.topic ? { topic: d.topic as string } : {}),
        ...(d.routing_key ? { routing_key: d.routing_key as string } : {}),
        ...(d.label_topic ? { label_topic: d.label_topic as string } : {}),
      })),
  }));
}

export default async function runsReadRoutes(app: FastifyInstance) {
  const db = getDb();
  const runs = new RunRepository(db);
  const runPartitions = new RunPartitionRepository(db);
  const deliveries = new RunDeliveryRepository(db);

  app.get("/runs", async (request) => {
    const { limit, cursor } = request.query as { limit?: string; cursor?: string };
    return {
      runs: await describeRuns(db, await runs.list(limit ? Number(limit) : undefined, cursor)),
    };
  });

  app.get("/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await runs.getById(id);
    if (!run) {
      reply.status(404);
      return { error: { code: "not_found", message: `Run "${id}" not found` } };
    }
    const [described] = await describeRuns(db, [run]);
    return { ...described!, deliveries: (await deliveries.listByRun(id)).map(serializeDelivery) };
  });

  // v1: per-partition state rows double as a coarse log surface until a
  // dedicated log store exists.
  app.get("/runs/:id/logs", async (request) => {
    const { id } = request.params as { id: string };
    return { logs: await runPartitions.listByRun(id) };
  });
}
