import { Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/layout/page-header.js";
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
      <div>
        <PageHeader title="Launch a run" />
        <div data-testid="run-launch-control">
          <RunLaunch scenarioId={scenarioId} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Run control" />
      <div data-testid="run-list">
        <RunList />
      </div>
    </div>
  );
}

function RunDetailView() {
  const { runId } = useParams<{ runId: string }>();
  if (!runId) return null;
  return (
    <div>
      <PageHeader title="Run detail" />
      <div className="flex flex-col gap-6">
        <div data-testid="run-status-panel">
          <RunDetail runId={runId} />
        </div>
        <RunRecord runId={runId} />
        <div data-testid="export-controls">
          <ExportControls runId={runId} />
        </div>
      </div>
    </div>
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
