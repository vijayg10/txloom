import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { apiClient, ApiError } from "../../api/client.js";
import { StreamConsole } from "./stream-console.js";
import { StreamLauncher } from "./stream-launcher.js";

interface RunRow {
  id: string;
  status: string;
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
    <section>
      <h1>Stream console</h1>
      <p>Pick a completed run to start or watch its live stream.</p>
      <ul data-testid="stream-run-picker">
        {runs.map((run) => (
          <li key={run.id}>
            <Link data-testid="stream-run-picker-item" to={`/stream/${run.id}`}>
              {run.id}
            </Link>
          </li>
        ))}
      </ul>
    </section>
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

  if (!runId || hasStream === null) return <p>Loading…</p>;

  return (
    <section>
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
    </section>
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
