import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { apiClient } from "../../api/client.js";
import { PageHeader } from "../../components/layout/page-header.js";
import { Card, CardBody } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { StatusBadge, runStatusTone } from "../../components/ui/status-badge.js";
import type { RunStatus } from "../run-control/run-status.js";
import { ActorStory } from "./actor-story.js";
import { GroundTruthExplorer } from "./explorer.js";

interface RunRow {
  id: string;
  status: RunStatus;
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
    <div>
      <PageHeader title="Ground-truth explorer" />
      {runs.length === 0 ? (
        <EmptyState
          title="No runs available"
          description="Launch a run to explore its ground truth."
        />
      ) : (
        <Card>
          <CardBody>
            <ul
              className="divide-border flex flex-col divide-y"
              data-testid="ground-truth-run-picker"
            >
              {runs.map((run) => (
                <li key={run.id} className="py-2.5">
                  <Link
                    data-testid="ground-truth-run-picker-item"
                    to={`/ground-truth/${run.id}`}
                    className="flex items-center gap-3"
                  >
                    <span className="text-primary font-medium hover:underline">{run.id}</span>
                    <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
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

function GroundTruthRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const [actorId, setActorId] = useState<string | null>(null);
  if (!runId) return null;

  return (
    <div>
      <PageHeader title="Ground truth" meta={`Run ${runId}`} />
      <div className="flex flex-col gap-6">
        <div data-testid="ground-truth-explorer">
          <GroundTruthExplorer runId={runId} onSelectActor={setActorId} />
        </div>
        {actorId && (
          <div data-testid="ground-truth-actor-story">
            <ActorStory runId={runId} actorId={actorId} />
          </div>
        )}
      </div>
    </div>
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
