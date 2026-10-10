import type { OutputSinkRef } from "@txloom/spec";
import type { Connection, DestinationInput, KafkaConfig, RabbitConfig } from "../../api/client.js";
import { FormField } from "../ui/form-field.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";

const NEW_CONNECTION = "__new__";

interface DestinationPickerProps {
  sinks: OutputSinkRef[];
  connections: Connection[];
  destinations: DestinationInput[];
  onChange: (destinations: DestinationInput[]) => void;
  onNewConnection: (sink: OutputSinkRef) => void;
}

export function defaultTargetFor(connection: Connection | undefined): {
  topic?: string;
  routing_key?: string;
} {
  if (!connection) return {};
  if (connection.type === "kafka") {
    return { topic: (connection.config as KafkaConfig).default_topic };
  }
  if (connection.type === "rabbitmq") {
    return { routing_key: (connection.config as RabbitConfig).default_routing_key };
  }
  return {};
}

/** One row per spec sink, reused by the Launch drawer (T015) and anywhere else a
 * run or stream needs destinations bound (T014). File sinks need no connection. */
export function DestinationPicker({
  sinks,
  connections,
  destinations,
  onChange,
  onNewConnection,
}: DestinationPickerProps) {
  function destinationFor(sink: string): DestinationInput | undefined {
    return destinations.find((d) => d.sink === sink);
  }

  function setDestination(sink: string, patch: Partial<DestinationInput>) {
    const existing = destinationFor(sink);
    const next: DestinationInput = { sink, connection_id: "", ...existing, ...patch };
    onChange([...destinations.filter((d) => d.sink !== sink), next]);
  }

  function removeDestination(sink: string) {
    onChange(destinations.filter((d) => d.sink !== sink));
  }

  return (
    <div className="flex flex-col gap-4">
      {sinks.map((sink) => {
        if (sink.type === "file") {
          return (
            <div
              key={sink.name}
              data-testid={`launch-sink-row-${sink.name}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-text text-sm font-medium">{sink.name}</span>
              <span className="text-text-secondary text-xs">File download</span>
            </div>
          );
        }

        const candidates = connections.filter((c) => c.type === sink.type);
        const current = destinationFor(sink.name);
        const connection = candidates.find((c) => c.id === current?.connection_id);

        return (
          <div
            key={sink.name}
            data-testid={`launch-sink-row-${sink.name}`}
            className="border-border grid gap-3 rounded-xl border p-3 sm:grid-cols-2"
          >
            <FormField label={`${sink.name} destination`}>
              <Select
                data-testid={`launch-destination-${sink.name}`}
                value={current?.connection_id ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === NEW_CONNECTION) {
                    onNewConnection(sink);
                    return;
                  }
                  const picked = candidates.find((c) => c.id === value);
                  if (value === "") {
                    removeDestination(sink.name);
                    return;
                  }
                  setDestination(sink.name, { connection_id: value, ...defaultTargetFor(picked) });
                }}
              >
                <option value="">Choose a connection…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={NEW_CONNECTION}>New connection…</option>
              </Select>
            </FormField>
            {connection && sink.type !== "webhook" && (
              <FormField label={connection.type === "kafka" ? "Topic" : "Routing key"}>
                <Input
                  data-testid={`launch-topic-${sink.name}`}
                  value={
                    connection.type === "kafka" ? (current?.topic ?? "") : (current?.routing_key ?? "")
                  }
                  onChange={(e) =>
                    setDestination(sink.name, {
                      connection_id: connection.id,
                      ...(connection.type === "kafka"
                        ? { topic: e.target.value }
                        : { routing_key: e.target.value }),
                    })
                  }
                />
              </FormField>
            )}
          </div>
        );
      })}
    </div>
  );
}
