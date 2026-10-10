import type { Knex } from "knex";
import { RunDeliveryRepository } from "../db/repositories/run-deliveries.js";
import { RunDestinationRepository } from "../db/repositories/run-destinations.js";
import { getQueues } from "./queues.js";

export interface DeliverJobPayload {
  runId: string;
  sinkName: string;
  destination: {
    sink: string;
    connectionId: string;
    topic?: string;
    routingKey?: string;
    labelTopic?: string;
  };
  dataDir: string;
  engineVersion: number;
}

/** Enqueues the `deliver` job for one run delivery. `attempt` numbers retries so each gets a
 * fresh job ID (BullMQ ignores an add whose ID already exists). */
export async function enqueueDelivery(payload: DeliverJobPayload, attempt = 0): Promise<void> {
  await getQueues().deliver.add(`deliver-${payload.runId}-${payload.sinkName}`, payload, {
    jobId: `deliver-${payload.runId}-${payload.sinkName}${attempt > 0 ? `-r${attempt}` : ""}`,
  });
}

/** Resolves a run's launch destination for a sink into a deliver job payload. */
export async function deliverPayloadFor(
  db: Knex,
  run: { id: string; engine_version: number },
  sinkName: string,
  dataDir: string,
): Promise<DeliverJobPayload | undefined> {
  const destination = (await new RunDestinationRepository(db).listByRun(run.id)).find(
    (d) => d.sink_name === sinkName,
  );
  if (!destination?.connection_id) return undefined;
  return {
    runId: run.id,
    sinkName,
    destination: {
      sink: sinkName,
      connectionId: destination.connection_id,
      ...(destination.topic ? { topic: destination.topic } : {}),
      ...(destination.routing_key ? { routingKey: destination.routing_key } : {}),
      ...(destination.label_topic ? { labelTopic: destination.label_topic } : {}),
    },
    dataDir,
    engineVersion: run.engine_version,
  };
}

/** History replay (FR-021): once a run has generated, creates a `run_deliveries` row for every
 * bound sink and queues its `deliver` job. Safe to call twice: existing rows are kept. */
export async function startDeliveries(
  db: Knex,
  run: { id: string; engine_version: number },
  dataDir: string,
): Promise<void> {
  const deliveries = new RunDeliveryRepository(db);
  for (const destination of await new RunDestinationRepository(db).listByRun(run.id)) {
    if (!destination.connection_id) continue;
    const payload = await deliverPayloadFor(db, run, destination.sink_name, dataDir);
    if (!payload) continue;
    await deliveries.create({
      run_id: run.id,
      sink_name: destination.sink_name,
      destination_snapshot: {
        sink: destination.sink_name,
        connection_id: destination.connection_id,
        connection_name: destination.connection_name,
        connection_type: destination.connection_type,
        ...(destination.topic ? { topic: destination.topic } : {}),
        ...(destination.routing_key ? { routing_key: destination.routing_key } : {}),
      },
    });
    await enqueueDelivery(payload);
  }
}
