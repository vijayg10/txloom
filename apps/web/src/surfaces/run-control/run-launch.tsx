import { useState } from "react";
import { apiClient } from "../../api/client.js";

interface RunRow {
  id: string;
  status: string;
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
    <div className="run-launch">
      <button
        type="button"
        data-testid="launch-run-button"
        onClick={() => void launch()}
        disabled={launching}
      >
        {launching ? "Launching…" : "Run"}
      </button>
      {error && <p role="alert">{error}</p>}
      {run && (
        <div className="run-detail" data-testid="run-launch-result">
          <p data-testid="run-status">
            Run <code>{run.id}</code> — status: <strong>{run.status}</strong>
          </p>
          <p>seed: {run.seed}</p>
          <a data-testid="view-run-link" href={`/runs/${run.id}`}>
            View run
          </a>
        </div>
      )}
    </div>
  );
}
