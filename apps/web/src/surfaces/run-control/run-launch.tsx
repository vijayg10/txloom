import { useState } from "react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody } from "../../components/ui/card.js";
import { StatusBadge, runStatusTone } from "../../components/ui/status-badge.js";
import type { RunStatus } from "./run-status.js";

interface RunRow {
  id: string;
  status: RunStatus;
  seed: string;
  created_at: string;
}

/** Minimal run-launch + run-detail — status and download links. Full run
 * control (pause/resume/cancel, live progress, ETA) arrives with US3;
 * this is the smallest useful surface for US1's generate → export loop. */
export function RunLaunch({ scenarioId }: { scenarioId: string }) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setLaunching(true);
    setError(null);
    try {
      const launched = await apiClient.post<RunRow>(`/scenarios/${scenarioId}/runs`, {});
      setRun(launched);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch run");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button data-testid="launch-run-button" onClick={() => void launch()} loading={launching}>
          {launching ? "Launching…" : "Run"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      {run && (
        <Card data-testid="run-launch-result">
          <CardBody className="flex flex-col gap-2">
            <p data-testid="run-status" className="flex items-center gap-2">
              Run <code className="font-mono">{run.id}</code> — status:{" "}
              <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
            </p>
            <p className="text-text-secondary">seed: {run.seed}</p>
            <a
              data-testid="view-run-link"
              href={`/runs/${run.id}`}
              className="text-primary hover:underline"
            >
              View run
            </a>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
