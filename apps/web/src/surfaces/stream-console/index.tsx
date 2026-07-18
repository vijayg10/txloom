import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { apiClient, ApiError } from "../../api/client.js";
import { PageHeader } from "../../components/layout/page-header.js";
import { Card, CardBody } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import type { RunStatus } from "../run-control/run-status.js";
import { StreamConsole } from "./stream-console.js";
import { StreamLauncher } from "./stream-launcher.js";

interface RunRow {
  id: string;
  status: RunStatus;
}

function StreamRunPicker() {
  const [runs, setRuns] = useState<RunRow[]>([]);

  useEffect(() => {
    apiClient
      .get<{ runs: RunRow[] }>("/runs")
      .then((res) => setRuns(res.runs.filter((run) => run.status === "completed")))
      .catch(() => setRuns([]));
  }, []);

  return (
    <div>
      <PageHeader
        title="Stream console"
        meta="Pick a completed run to start or watch its live stream."
      />
      {runs.length === 0 ? (
        <EmptyState
          title="No completed runs"
          description="Complete a run to start streaming its events."
        />
      ) : (
        <Card>
          <CardBody>
            <ul className="divide-border flex flex-col divide-y" data-testid="stream-run-picker">
              {runs.map((run) => (
                <li key={run.id} className="py-2.5">
                  <Link
                    data-testid="stream-run-picker-item"
                    to={`/stream/${run.id}`}
                    className="text-primary font-medium hover:underline"
                  >
                    {run.id}
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function StreamRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const [hasStream, setHasStream] = useState<boolean | null>(null);

  useEffect(() => {
    if (!runId) return;
    apiClient
      .get(`/runs/${runId}/stream`)
      .then(() => setHasStream(true))
      .catch((err) => setHasStream(err instanceof ApiError && err.status === 404 ? false : true));
  }, [runId]);

  if (!runId || hasStream === null) {
    return (
      <div>
        <PageHeader title="Stream console" />
        <p className="text-text-secondary text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Stream console" meta={`Run ${runId}`} />
      {!hasStream && (
        <div data-testid="stream-launcher">
          <StreamLauncher runId={runId} onStarted={() => setHasStream(true)} />
        </div>
      )}
      {hasStream && (
        <div data-testid="stream-console">
          <StreamConsole runId={runId} />
        </div>
      )}
    </div>
  );
}

export function StreamConsolePage() {
  return (
    <Routes>
      <Route index element={<StreamRunPicker />} />
      <Route path=":runId" element={<StreamRunDetail />} />
    </Routes>
  );
}
