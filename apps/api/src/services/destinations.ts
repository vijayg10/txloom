import type { SimulationSpec } from "@txloom/spec";
import type { ConnectionRow } from "../db/repositories/connections.js";
import type { ConnectionType, RunDestinationInput } from "../db/repositories/run-destinations.js";

export interface DestinationInput {
  sink: string;
  connection_id: string;
  topic?: string;
  routing_key?: string;
  label_topic?: string;
}

export interface DestinationValidationError {
  code: "sink_without_destination" | "destination_type_mismatch" | "unknown_connection";
  message: string;
  details: { sink: string };
}

/**
 * Validates a launch/stream-start's destinations against the spec's non-file sinks and the
 * caller's saved connections (data-model.md §1.4): every non-file sink needs exactly one
 * bound connection, of the same type as the sink (FR-008). No broker address, URL or
 * credential can be supplied directly — only a `connection_id` (contract invariant 2).
 */
export function validateDestinations(
  spec: SimulationSpec,
  destinations: DestinationInput[],
  connections: ConnectionRow[],
): DestinationValidationError | null {
  const byConnectionId = new Map(connections.map((c) => [c.id, c]));
  const byName = new Map(destinations.map((d) => [d.sink, d]));

  for (const sink of spec.output.sinks) {
    if (sink.type === "file") continue;
    const destination = byName.get(sink.name);
    if (!destination) {
      return {
        code: "sink_without_destination",
        message: `Sink "${sink.name}" needs a destination before you can launch.`,
        details: { sink: sink.name },
      };
    }
    const connection = byConnectionId.get(destination.connection_id);
    if (!connection) {
      return {
        code: "unknown_connection",
        message: `Sink "${sink.name}" is bound to a connection that doesn't exist.`,
        details: { sink: sink.name },
      };
    }
    if (connection.type !== sink.type) {
      return {
        code: "destination_type_mismatch",
        message: `Sink "${sink.name}" is type "${sink.type}", but its destination "${connection.name}" is type "${connection.type}".`,
        details: { sink: sink.name },
      };
    }
  }

  return null;
}

/** Snapshots each destination's connection name/type at launch (research R10) — the
 * resulting rows are immutable: `run_destinations` never changes after insert. Assumes
 * `validateDestinations` has already passed. */
export function snapshotDestinations(
  destinations: DestinationInput[],
  connections: ConnectionRow[],
): RunDestinationInput[] {
  const byConnectionId = new Map(connections.map((c) => [c.id, c]));
  return destinations.map((d) => {
    const connection = byConnectionId.get(d.connection_id)!;
    return {
      sink_name: d.sink,
      connection_id: d.connection_id,
      connection_name: connection.name,
      connection_type: connection.type as ConnectionType,
      ...(d.topic ? { topic: d.topic } : {}),
      ...(d.routing_key ? { routing_key: d.routing_key } : {}),
      ...(d.label_topic ? { label_topic: d.label_topic } : {}),
    };
  });
}
