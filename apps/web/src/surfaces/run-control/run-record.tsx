import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

interface RunRow {
  id: string;
  scenario_id: string;
  spec_snapshot: unknown;
  seed: string;
  status: string;
  outputs_deleted_at: string | null;
  created_at: string;
  completed_at: string | null;
}

/** Immutable run-record view: spec snapshot + seed + report + outputs links,
 * one-click "exactly this dataset" regenerate button (FR-033). */
export function RunRecord({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    apiClient
      .get<RunRow>(`/runs/${runId}`)
      .then(setRun)
      .catch(() => setRun(null));
  }, [runId]);

  async function regenerate() {
    setRegenerating(true);
    try {
      const newRun = await apiClient.post<RunRow>(`/runs/${runId}/regenerate`);
      window.location.href = `/runs/${newRun.id}`;
    } finally {
      setRegenerating(false);
    }
  }

  if (!run) return <p>Loading…</p>;

  return (
    <div className="run-record">
      <h2>Immutable run record</h2>
      <dl>
        <dt>Run</dt>
        <dd>
          <code>{run.id}</code>
        </dd>
        <dt>Scenario</dt>
        <dd>
          <a href={`/scenarios/${run.scenario_id}`}>{run.scenario_id}</a>
        </dd>
        <dt>Seed</dt>
        <dd>{run.seed}</dd>
        <dt>Status</dt>
        <dd>{run.status}</dd>
        <dt>Created</dt>
        <dd>{new Date(run.created_at).toLocaleString()}</dd>
      </dl>
      {run.outputs_deleted_at ? (
        <p>Outputs deleted — use Regenerate to recreate this exact dataset.</p>
      ) : (
        <p>
          <a href={`/api/v1/runs/${run.id}/report`}>Realism report</a> ·{" "}
          <a href={`/runs/${run.id}/exports`}>Exports</a>
        </p>
      )}
      <button type="button" onClick={() => void regenerate()} disabled={regenerating}>
        {regenerating ? "Regenerating…" : "Regenerate exactly this dataset"}
      </button>
    </div>
  );
}
