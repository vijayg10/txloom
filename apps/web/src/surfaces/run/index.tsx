import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import type { OutputSinkRef } from "@txloom/spec";
import {
  createApiClient,
  type Connection,
  type DestinationInput,
  type Run,
  type Stream,
} from "../../api/client.js";
import { DestinationPicker } from "../../components/data/destination-picker.js";
import { PageHeader } from "../../components/layout/page-header.js";
import { Button } from "../../components/ui/button.js";
import { ErrorBoundary } from "../../components/ui/error-boundary.js";
import { StatusBadge, runStatusTone } from "../../components/ui/status-badge.js";
import { cn } from "../../lib/cn.js";
import { ExportControls } from "../ground-truth/export-controls.js";
import { TruthTab } from "../ground-truth/index.js";
import { RunDetail } from "../run-control/run-detail.js";
import { RunRecord } from "../run-control/run-record.js";
import { LiveTab } from "../stream-console/index.js";
import { InspectTab } from "../world-inspector/index.js";
import { DestinationChip } from "./destination-chip.js";

const TABS = [
  { key: "progress", label: "Progress" },
  { key: "live", label: "Live" },
  { key: "inspect", label: "Inspect" },
  { key: "truth", label: "Ground truth" },
  { key: "export", label: "Export" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** "Scenario · v3 · 10 Oct 14:02" — a run is named by what it ran, not by its ID (FR-050). */
export function formatRunTitle(run: Pick<Run, "scenario" | "spec_version" | "started_at">): string {
  const started = run.started_at ? new Date(run.started_at) : null;
  const when = started
    ? started.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "not started";
  return `${run.scenario.name} · v${run.spec_version.number} · ${when}`;
}

function TabPanel({
  runId,
  tab,
  runStatus,
}: {
  runId: string;
  tab: TabKey;
  runStatus: Run["status"] | undefined;
}) {
  switch (tab) {
    case "progress":
      return (
        <div data-testid="run-tab-panel-progress" className="flex flex-col gap-6">
          <div data-testid="run-status-panel">
            <RunDetail runId={runId} />
          </div>
          <RunRecord runId={runId} />
        </div>
      );
    case "live":
      return (
        <div data-testid="run-tab-panel-live">
          <LiveTab runId={runId} />
        </div>
      );
    case "inspect":
      return (
        <div data-testid="run-tab-panel-inspect">
          <InspectTab runId={runId} runStatus={runStatus} />
        </div>
      );
    case "truth":
      return (
        <div data-testid="run-tab-panel-truth">
          <TruthTab runId={runId} />
        </div>
      );
    case "export":
      return (
        <div data-testid="run-tab-panel-export">
          <div data-testid="export-controls">
            <ExportControls runId={runId} />
          </div>
        </div>
      );
  }
}

interface DestinationEditorProps {
  run: Run;
  stream: Stream | null;
  onSaved: () => void;
  onCancel: () => void;
}

/** Changes where the next live session delivers (FR-048). Only the stream's destinations change:
 * the run's launch record stays as it was. */
function DestinationEditor({ run, stream, onSaved, onCancel }: DestinationEditorProps) {
  const client = createApiClient();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [destinations, setDestinations] = useState<DestinationInput[]>(
    (stream?.destinations?.length ? stream.destinations : run.launch_destinations).map((d) => ({
      sink: d.sink,
      connection_id: d.connection_id,
      ...(d.topic ? { topic: d.topic } : {}),
      ...(d.routing_key ? { routing_key: d.routing_key } : {}),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const sinks = (run.spec_snapshot as { output?: { sinks?: OutputSinkRef[] } }).output?.sinks ?? [];

  useEffect(() => {
    client.listConnections().then((res) => setConnections(res.connections));
  }, []);

  async function save() {
    setError(null);
    try {
      await client.setStreamDestinations(run.id, destinations);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not change destinations");
    }
  }

  return (
    <div data-testid="live-destination-editor" className="border-border mb-4 rounded-xl border p-4">
      <DestinationPicker
        sinks={sinks}
        connections={connections}
        destinations={destinations}
        onChange={setDestinations}
        onNewConnection={() => setError("Create the connection on the Connections page first.")}
      />
      {error && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button data-testid="live-destination-save" onClick={() => void save()}>
          Save destinations
        </Button>
      </div>
    </div>
  );
}

/** The one-page-per-run shell (FR-047): tabs Progress · Live · Inspect · Ground truth · Export
 * over a single run, its title, and its read-only destination chip. While on Progress it moves to
 * Live by itself when the run goes live, unless the user has switched tabs. */
export function RunPage({ pollMs = 2000 }: { pollMs?: number }) {
  const { runId, tab: rawTab } = useParams<{ runId: string; tab: string }>();
  const navigate = useNavigate();
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "progress";
  const [run, setRun] = useState<Run | null>(null);
  const [stream, setStream] = useState<Stream | null>(null);
  const [editing, setEditing] = useState(false);
  // Only a page opened on Progress follows the run to Live; any manual tab choice ends that.
  const followRun = useRef(tab === "progress");
  const tabRef = useRef(tab);
  tabRef.current = tab;

  function refreshStream() {
    if (!runId) return;
    createApiClient()
      .getStream(runId)
      .then(setStream)
      .catch(() => setStream(null));
  }

  useEffect(() => {
    if (!runId) return;
    const client = createApiClient();
    let active = true;
    const load = () =>
      client
        .getRun(runId)
        .then((loaded) => {
          if (!active) return;
          setRun(loaded);
          if (loaded.phase === "live" && followRun.current && tabRef.current === "progress") {
            followRun.current = false;
            navigate(`/runs/${runId}/live`, { replace: true });
          }
        })
        .catch(() => {
          if (active) setRun(null);
        });
    void load();
    refreshStream();
    const timer = setInterval(() => {
      void load();
      refreshStream();
    }, pollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // refreshStream only closes over `runId`.
  }, [runId, pollMs, navigate]);

  if (!runId) return null;

  return (
    <div>
      <PageHeader
        title={run ? formatRunTitle(run) : runId}
        {...(run ? { meta: run.id } : {})}
        {...(run
          ? {
              actions: (
                <StatusBadge tone={runStatusTone(run.status)} data-testid="run-phase">
                  {run.phase ?? run.status}
                </StatusBadge>
              ),
            }
          : {})}
      />
      <p data-testid="run-title" className="sr-only">
        {run ? formatRunTitle(run) : runId}
      </p>

      {run && (
        <div className="mb-4">
          <DestinationChip
            destinations={run.launch_destinations}
            canChange={stream?.state === "stopped"}
            onChange={() => setEditing(true)}
          />
        </div>
      )}
      {run && editing && (
        <DestinationEditor
          run={run}
          stream={stream}
          onSaved={() => {
            setEditing(false);
            refreshStream();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      <nav className="border-border mb-6 flex gap-1 border-b" aria-label="Run tabs">
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={`/runs/${runId}/${t.key}`}
            data-testid={`run-tab-${t.key}`}
            onClick={() => {
              followRun.current = false;
            }}
            className={({ isActive }) =>
              cn(
                "border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                isActive || tab === t.key
                  ? "border-primary text-primary"
                  : "text-text-secondary hover:text-text border-transparent",
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <ErrorBoundary key={`${runId}/${tab}`} label="This tab">
        <TabPanel runId={runId} tab={tab} runStatus={run?.status} />
      </ErrorBoundary>
    </div>
  );
}
