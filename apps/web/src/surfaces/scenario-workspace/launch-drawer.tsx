import { useEffect, useMemo, useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { ChevronDown, X } from "lucide-react";
import type { SimulationSpec } from "@txloom/spec";
import {
  createApiClient,
  type Connection,
  type ConnectionSuggestion,
  type DestinationInput,
  type Run,
  type RunEstimate,
} from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { defaultTargetFor, DestinationPicker } from "../../components/data/destination-picker.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input } from "../../components/ui/input.js";
import { ConnectionForm } from "../connections/connection-form.js";

interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  testId: string;
  children: React.ReactNode;
}

function SidePanel({ open, onOpenChange, title, testId, children }: SidePanelProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-gray-900/40" />
        <RadixDialog.Content
          data-testid={testId}
          className="border-border bg-card fixed top-0 right-0 z-50 flex h-full w-full max-w-[480px] flex-col overflow-y-auto border-l p-6 shadow-xl"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-text text-lg font-semibold">
              {title}
            </RadixDialog.Title>
            <VisuallyHidden asChild>
              <RadixDialog.Description>{title}</RadixDialog.Description>
            </VisuallyHidden>
            <RadixDialog.Close asChild>
              <button
                type="button"
                className="text-text-secondary hover:bg-hover rounded-lg p-1.5"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return "under a second";
  if (seconds < 90) return `~${Math.round(seconds)}s`;
  return `~${Math.round(seconds / 60)} min`;
}

interface LaunchDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarioId: string;
  spec: SimulationSpec | null;
  onLaunched: (run: Run) => void;
}

/** The Launch drawer (T015): destinations, mode, rate, Advanced (seed, label
 * channel, scale, replay history) and the estimate line. "New connection…"
 * opens the connection form in a nested side panel without losing the rest
 * of the draft (FR-045). */
export function LaunchDrawer({
  open,
  onOpenChange,
  scenarioId,
  spec,
  onLaunched,
}: LaunchDrawerProps) {
  const client = useMemo(() => createApiClient(), []);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [destinations, setDestinations] = useState<DestinationInput[]>([]);
  const [mode, setMode] = useState<"history_only" | "history_then_live">("history_only");
  const [targetTps, setTargetTps] = useState(50);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const [labelChannel, setLabelChannel] = useState(false);
  const [replayHistory, setReplayHistory] = useState(false);
  const [scaleConsumers, setScaleConsumers] = useState("");
  const [estimate, setEstimate] = useState<RunEstimate | null>(null);
  const [newConnectionFor, setNewConnectionFor] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Connections and the remembered defaults arrive separately; showing the form only once both
  // are in keeps a late response from overwriting a choice the user has already made.
  const [loaded, setLoaded] = useState(false);
  const [suggestion, setSuggestion] = useState<ConnectionSuggestion | null>(null);

  const sinks = spec?.output.sinks ?? [];
  const unboundBrokerSink = sinks.find(
    (s) => s.type !== "file" && !destinations.some((d) => d.sink === s.name && d.connection_id),
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoaded(false);
    Promise.all([
      client.listConnections(),
      client.getLaunchDefaults(scenarioId),
      client.getConnectionSuggestions().catch(() => ({ suggestions: [] })),
    ])
      .then(([list, defaults, offered]) => {
        if (cancelled) return;
        setConnections(list.connections);
        setSuggestion(offered.suggestions.find((s) => s.kind === "local_kafka") ?? null);
        setMode(defaults.mode);
        setTargetTps(defaults.target_tps ?? spec?.clock.then_stream_tps ?? 50);
        setReplayHistory(defaults.replay_history);
        setLabelChannel(defaults.label_channel);
        setDestinations(
          defaults.destinations
            .filter((d) => !d.connection_missing)
            .map((d) => ({
              sink: d.sink,
              connection_id: d.connection_id,
              ...(d.topic ? { topic: d.topic } : {}),
              ...(d.routing_key ? { routing_key: d.routing_key } : {}),
              ...(d.label_topic ? { label_topic: d.label_topic } : {}),
            })),
        );
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "could not load launch defaults");
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // `spec` only supplies the fallback rate; a spec edit must not reset the form.
  }, [open, scenarioId, client]);

  useEffect(() => {
    // Any broker destination defaults the mode to history-then-live (data-model.md).
    if (destinations.some((d) => d.connection_id)) setMode("history_then_live");
  }, [destinations]);

  useEffect(() => {
    if (!open || !spec) return;
    const handle = setTimeout(() => {
      client.estimateRun(spec, replayHistory).then(setEstimate);
    }, 250);
    return () => clearTimeout(handle);
  }, [open, spec, replayHistory, client]);

  // A replay into a topic that the broker expires sooner than the history spans loses its oldest
  // messages. Only a retention learned from the destination's last test can be compared; the API
  // repeats the check at launch. Never blocking.
  const historyMs = (spec?.clock.days ?? 0) * 24 * 60 * 60 * 1000;
  const retentionWarnings = replayHistory
    ? destinations.flatMap((destination) => {
        const connection = connections.find((c) => c.id === destination.connection_id);
        const retentionMs = connection?.health.topic?.retention_ms;
        if (connection?.type !== "kafka" || typeof retentionMs !== "number") return [];
        if (retentionMs >= historyMs) return [];
        return [{ sink: destination.sink, connection: connection.name, retentionMs }];
      })
    : [];

  const firstUnboundKafkaSink = sinks.find(
    (s) => s.type === "kafka" && !destinations.some((d) => d.sink === s.name && d.connection_id),
  );

  /** Registers the detected demo broker and binds it to the first Kafka sink that needs one. */
  async function addLocalKafka() {
    if (!suggestion) return;
    try {
      const connection = await client.createConnection(suggestion.input);
      setConnections((prev) => [...prev, connection]);
      setSuggestion(null);
      if (firstUnboundKafkaSink) {
        setDestinations((prev) => [
          ...prev.filter((d) => d.sink !== firstUnboundKafkaSink.name),
          {
            sink: firstUnboundKafkaSink.name,
            connection_id: connection.id,
            ...defaultTargetFor(connection),
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not add the local broker");
    }
  }

  async function launch() {
    if (unboundBrokerSink) {
      setError(`"${unboundBrokerSink.name}" needs a destination before you can launch.`);
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const run = await client.launchRun(scenarioId, {
        ...(seed ? { seed } : {}),
        mode,
        destinations,
        replay_history: replayHistory,
        target_tps: targetTps,
        label_channel: labelChannel,
        ...(scaleConsumers ? { scale_override: { consumers: Number(scaleConsumers) } } : {}),
      });
      // Close first: the caller's `onLaunched` navigates away, and closing the drawer afterwards
      // would navigate back to the scenario page.
      onOpenChange(false);
      onLaunched(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "launch failed");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title="Launch a run" testId="launch-drawer">
      {!loaded ? (
        <p data-testid="launch-loading" className="text-text-secondary text-sm">
          Loading…
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {suggestion && firstUnboundKafkaSink && (
            <div
              data-testid="local-kafka-suggestion"
              className="border-primary/30 bg-primary/5 flex flex-col gap-2 rounded-xl border p-3 text-sm"
            >
              <p>{suggestion.detail}</p>
              <div>
                <Button data-testid="local-kafka-add" onClick={() => void addLocalKafka()}>
                  Use it for "{firstUnboundKafkaSink.name}"
                </Button>
              </div>
            </div>
          )}
          <DestinationPicker
            sinks={sinks}
            connections={connections}
            destinations={destinations}
            onChange={setDestinations}
            onNewConnection={(sink) => setNewConnectionFor(sink.name)}
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-text-secondary text-xs font-medium">Mode</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                data-testid="launch-mode-history-only"
                checked={mode === "history_only"}
                onChange={() => setMode("history_only")}
              />
              History only
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                data-testid="launch-mode-history-then-live"
                checked={mode === "history_then_live"}
                onChange={() => setMode("history_then_live")}
              />
              History, then live
            </label>
          </fieldset>

          <FormField label="Rate (events/s)">
            <Input
              type="number"
              data-testid="launch-rate"
              value={targetTps}
              onChange={(e) => setTargetTps(Number(e.target.value))}
            />
          </FormField>

          <div>
            <button
              type="button"
              data-testid="launch-advanced"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="text-text-secondary flex items-center gap-1 text-sm font-medium"
            >
              Advanced
              <ChevronDown
                className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {advancedOpen && (
              <div className="mt-3 flex flex-col gap-4">
                <FormField label="Seed" hint="Leave blank to use the spec's seed">
                  <Input
                    data-testid="launch-seed"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                  />
                </FormField>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    data-testid="launch-label-channel"
                    checked={labelChannel}
                    onCheckedChange={(checked) => setLabelChannel(checked === true)}
                  />
                  Label channel
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    data-testid="launch-replay-history"
                    checked={replayHistory}
                    onCheckedChange={(checked) => setReplayHistory(checked === true)}
                  />
                  Replay history to destinations
                </label>
                <FormField label="Scale: consumers (optional)">
                  <Input
                    type="number"
                    data-testid="launch-scale-consumers"
                    value={scaleConsumers}
                    onChange={(e) => setScaleConsumers(e.target.value)}
                  />
                </FormField>
              </div>
            )}
          </div>

          {estimate && (
            <p data-testid="launch-estimate" className="text-text-secondary text-xs">
              ~{estimate.history_events.toLocaleString()} history events
              {estimate.replay_messages > 0
                ? `, ${estimate.replay_messages.toLocaleString()} replayed messages`
                : ""}{" "}
              across {estimate.partitions} partitions, {formatDuration(estimate.generation_seconds)}{" "}
              to generate.
            </p>
          )}

          {retentionWarnings.map((warning) => (
            <p
              key={warning.sink}
              data-testid="launch-warning-retention"
              className="text-xs text-amber-600"
            >
              The last test of "{warning.connection}" found a topic retention of{" "}
              {Math.max(1, Math.round(warning.retentionMs / (24 * 60 * 60 * 1000)))} day(s), shorter
              than this {spec?.clock.days}-day history. The oldest replayed messages may expire
              before a consumer reads them. You can still launch.
            </p>
          ))}

          {unboundBrokerSink && (
            <p data-testid="launch-error" className="text-danger text-sm">
              "{unboundBrokerSink.name}" needs a destination before you can launch.
            </p>
          )}
          {error && !unboundBrokerSink && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}

          <div className="mt-2 flex justify-end">
            <Button
              data-testid="launch-submit"
              onClick={() => void launch()}
              loading={launching}
              disabled={Boolean(unboundBrokerSink)}
            >
              Launch ▶
            </Button>
          </div>
        </div>
      )}

      <SidePanel
        open={newConnectionFor !== null}
        onOpenChange={(v) => !v && setNewConnectionFor(null)}
        title="New connection"
        testId="launch-new-connection-drawer"
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
      </SidePanel>
    </SidePanel>
  );
}
