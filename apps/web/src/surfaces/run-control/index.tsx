import { Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { ExportControls } from "../ground-truth/export-controls.js";
import { RunDetail } from "./run-detail.js";
import { RunLaunch } from "./run-launch.js";
import { RunList } from "./run-list.js";
import { RunRecord } from "./run-record.js";

function RunControlIndex() {
  const [searchParams] = useSearchParams();
  const scenarioId = searchParams.get("scenario");

  if (scenarioId) {
    return (
      <section>
        <h1>Launch a run</h1>
        <div data-testid="run-launch-control">
          <RunLaunch scenarioId={scenarioId} />
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1>Run control</h1>
      <div data-testid="run-list">
        <RunList />
      </div>
    </section>
  );
}

function RunDetailView() {
  const { runId } = useParams<{ runId: string }>();
  if (!runId) return null;
  return (
    <section>
      <div data-testid="run-status-panel">
        <RunDetail runId={runId} />
      </div>
      <RunRecord runId={runId} />
      <div data-testid="export-controls">
        <ExportControls runId={runId} />
      </div>
    </section>
  );
}

export function RunControlPage() {
  return (
    <Routes>
      <Route index element={<RunControlIndex />} />
      <Route path=":runId" element={<RunDetailView />} />
    </Routes>
  );
}
