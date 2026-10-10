import { useEffect, useMemo, useState } from "react";
import type { SimulationSpec } from "@txloom/spec";
import {
  apiClient,
  createApiClient,
  type Connection,
  type DestinationInput,
} from "../../api/client.js";
import { defaultTargetFor, DestinationPicker } from "../../components/data/destination-picker.js";
import { ConnectionForm } from "../connections/connection-form.js";
import { Modal } from "../../components/ui/modal.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody } from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { StatusBadge, runStatusTone } from "../../components/ui/status-badge.js";
import type { RunStatus } from "./run-status.js";

interface RunRow {
  id: string;
  status: RunStatus;
  seed: string;
  created_at: string;
}

interface SpecVersionRow {
  id: string;
  spec: unknown;
}

/** Minimal run-launch: pick a saved connection for each non-file sink (the same
 * `DestinationPicker` the Launch drawer uses), then launch. US5 moves this into the
 * drawer; until then UI launches send `destinations` from here. */
export function RunLaunch({ scenarioId }: { scenarioId: string }) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(() => createApiClient(), []);
  const [spec, setSpec] = useState<SimulationSpec | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [destinations, setDestinations] = useState<DestinationInput[]>([]);
  const [newConnectionFor, setNewConnectionFor] = useState<string | null>(null);
  const [replayHistory, setReplayHistory] = useState(false);

  useEffect(() => {
    void (async () => {
      const [scenario, versions, conns, defaults] = await Promise.all([
        apiClient.get<{ current_version_id: string | null }>(`/scenarios/${scenarioId}`),
        apiClient.get<{ versions: SpecVersionRow[] }>(`/scenarios/${scenarioId}/versions`),
        client.listConnections(),
        client.getLaunchDefaults(scenarioId).catch(() => null),
      ]);
      const current =
        versions.versions.find((v) => v.id === scenario.current_version_id) ??
        versions.versions[versions.versions.length - 1];
      setSpec((current?.spec as SimulationSpec | undefined) ?? null);
      setConnections(conns.connections);
      if (defaults) {
        setDestinations(
          defaults.destinations
            .filter((d) => d.connection_id && !d.connection_missing)
            .map((d) => ({
              sink: d.sink,
              connection_id: d.connection_id,
              ...(d.topic ? { topic: d.topic } : {}),
              ...(d.routing_key ? { routing_key: d.routing_key } : {}),
            })),
        );
      }
    })().catch((err) => setError(err instanceof Error ? err.message : "Failed to load scenario"));
  }, [scenarioId, client]);

  const sinks = spec?.output.sinks ?? [];
  const unbound = sinks.find(
    (s) => s.type !== "file" && !destinations.some((d) => d.sink === s.name && d.connection_id),
  );

  async function launch() {
    setLaunching(true);
    setError(null);
    try {
      const launched = await apiClient.post<RunRow>(`/scenarios/${scenarioId}/runs`, {
        destinations,
        ...(replayHistory ? { replay_history: true } : {}),
      });
      setRun(launched);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch run");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DestinationPicker
        sinks={sinks}
        connections={connections}
        destinations={destinations}
        onChange={setDestinations}
        onNewConnection={(sink) => setNewConnectionFor(sink.name)}
      />
      {destinations.length > 0 && (
        <label className="text-text flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox
            data-testid="launch-replay-history"
            checked={replayHistory}
            onCheckedChange={(checked) => setReplayHistory(checked === true)}
          />
          Replay the generated history to the broker destinations before going live
        </label>
      )}
      {unbound && (
        <p data-testid="launch-error" className="text-danger text-sm">
          "{unbound.name}" needs a destination before you can launch.
        </p>
      )}
      <Modal
        open={newConnectionFor !== null}
        onOpenChange={(open) => !open && setNewConnectionFor(null)}
        title="New connection"
      >
        <ConnectionForm
          onSaved={(connection) => {
            setConnections((prev) => [...prev, connection]);
            if (newConnectionFor) {
              setDestinations((prev) => [
                ...prev.filter((d) => d.sink !== newConnectionFor),
                {
                  sink: newConnectionFor,
                  connection_id: connection.id,
                  ...defaultTargetFor(connection),
                },
              ]);
            }
            setNewConnectionFor(null);
          }}
          onCancel={() => setNewConnectionFor(null)}
        />
      </Modal>
      <div>
        <Button
          data-testid="launch-run-button"
          onClick={() => void launch()}
          loading={launching}
          disabled={Boolean(unbound)}
        >
          {launching ? "Launching…" : "Run"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      {run && (
        <Card data-testid="run-launch-result">
          <CardBody className="flex flex-col gap-2">
            <p data-testid="run-status" className="flex items-center gap-2">
              Run <code className="font-mono">{run.id}</code> — status:{" "}
              <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
            </p>
            <p className="text-text-secondary">seed: {run.seed}</p>
            <a
              data-testid="view-run-link"
              href={`/runs/${run.id}`}
              className="text-primary hover:underline"
            >
              View run
            </a>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
