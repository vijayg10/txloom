import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { apiClient } from "../../api/client.js";
import { ActorStory } from "./actor-story.js";
import { GroundTruthExplorer } from "./explorer.js";

interface RunRow {
  id: string;
  status: string;
}

function GroundTruthRunPicker() {
  const [runs, setRuns] = useState<RunRow[]>([]);

  useEffect(() => {
    apiClient
      .get<{ runs: RunRow[] }>("/runs")
      .then((res) => setRuns(res.runs))
      .catch(() => setRuns([]));
  }, []);

  return (
    <section>
      <h1>Ground-truth explorer</h1>
      <ul data-testid="ground-truth-run-picker">
        {runs.map((run) => (
          <li key={run.id}>
            <Link data-testid="ground-truth-run-picker-item" to={`/ground-truth/${run.id}`}>
              {run.id} ({run.status})
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GroundTruthRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const [actorId, setActorId] = useState<string | null>(null);
  if (!runId) return null;

  return (
    <section>
      <h1>
        Ground truth — run <code>{runId}</code>
      </h1>
      <div data-testid="ground-truth-explorer">
        <GroundTruthExplorer runId={runId} onSelectActor={setActorId} />
      </div>
      {actorId && (
        <div data-testid="ground-truth-actor-story">
          <ActorStory runId={runId} actorId={actorId} />
        </div>
      )}
    </section>
  );
}

export function GroundTruthPage() {
  return (
    <Routes>
      <Route index element={<GroundTruthRunPicker />} />
      <Route path=":runId" element={<GroundTruthRunDetail />} />
    </Routes>
  );
}
