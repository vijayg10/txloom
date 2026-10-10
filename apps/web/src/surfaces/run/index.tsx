import { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { createApiClient, type Run } from "../../api/client.js";
import { PageHeader } from "../../components/layout/page-header.js";
import { StatusBadge, runStatusTone } from "../../components/ui/status-badge.js";
import { cn } from "../../lib/cn.js";
import { DestinationChip } from "./destination-chip.js";

const TABS = [
  { key: "progress", label: "Progress" },
  { key: "live", label: "Live" },
  { key: "inspect", label: "Inspect" },
  { key: "truth", label: "Ground truth" },
  { key: "export", label: "Export" },
] as const;

function formatRunTitle(run: Run): string {
  const started = run.started_at ? new Date(run.started_at) : null;
  const when = started
    ? started.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "not started";
  return `${run.scenario.name} · v${run.spec_version.number} · ${when}`;
}

function TabPanel({ runId, tab }: { runId: string; tab: (typeof TABS)[number]["key"] }) {
  // Placeholder panels for the prototype (T016); US8's T175 hosts the real
  // surfaces (run-detail, stream-console, world-inspector, ground-truth,
  // export-controls) inside these tabs without a run picker.
  return (
    <div data-testid={`run-tab-panel-${tab}`} className="text-text-secondary text-sm">
      {tab} view for run {runId} (wired in a later phase).
    </div>
  );
}

/** The one-page-per-run shell (T016, US8): tabs Progress · Live · Inspect ·
 * Ground truth · Export, with the run title and the read-only destination
 * chip. Automatic tab switching to Live on `phase:"live"` lands in T169/T175. */
export function RunPage() {
  const { runId, tab: rawTab } = useParams<{ runId: string; tab: string }>();
  const tab = TABS.some((t) => t.key === rawTab) ? (rawTab as (typeof TABS)[number]["key"]) : "progress";
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    if (!runId) return;
    const client = createApiClient();
    client.getRun(runId).then(setRun).catch(() => setRun(null));
  }, [runId]);

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
          <DestinationChip destinations={run.launch_destinations} canChange={false} />
        </div>
      )}

      <nav className="border-border mb-6 flex gap-1 border-b" aria-label="Run tabs">
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={`/runs/${runId}/${t.key}`}
            data-testid={`run-tab-${t.key}`}
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

      <TabPanel runId={runId} tab={tab} />
    </div>
  );
}
