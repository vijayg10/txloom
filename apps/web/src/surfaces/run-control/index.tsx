import { Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/layout/page-header.js";
import { RunList } from "./run-list.js";

function RunControlIndex() {
  const [searchParams] = useSearchParams();
  const scenarioId = searchParams.get("scenario");

  // The old stand-alone launch page: launching now happens in the scenario page's drawer.
  if (scenarioId) return <Navigate to={`/scenarios/${scenarioId}?launch=1`} replace />;

  return (
    <div>
      <PageHeader title="Runs" />
      <div data-testid="run-list">
        <RunList />
      </div>
    </div>
  );
}

/** `/runs` (the list) and `/runs/new?scenario=` (redirect). A run itself lives at
 * `/runs/:id/:tab`, which the app shell routes to the run page. */
export function RunControlPage() {
  return (
    <Routes>
      <Route index element={<RunControlIndex />} />
      <Route path="new" element={<RunControlIndex />} />
      <Route path=":runId" element={<RunRedirect />} />
    </Routes>
  );
}

function RunRedirect() {
  const { runId } = useParams<{ runId: string }>();
  return <Navigate to={`/runs/${runId}/progress`} replace />;
}
