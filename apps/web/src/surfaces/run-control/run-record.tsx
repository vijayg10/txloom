import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import type { RunStatus } from "./run-status.js";

interface RunRow {
  id: string;
  scenario_id: string;
  spec_snapshot: unknown;
  seed: string;
  status: RunStatus;
  outputs_deleted_at: string | null;
  created_at: string;
  completed_at: string | null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-text-secondary text-xs font-medium">{label}</dt>
      <dd className="text-text mt-0.5 text-sm">{children}</dd>
    </div>
  );
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

  if (!run) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-secondary text-sm">Loading…</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card data-testid="run-record">
      <CardHeader>
        <CardTitle>Immutable run record</CardTitle>
      </CardHeader>
      <CardBody>
        <dl className="mb-4 grid gap-4 sm:grid-cols-2">
          <Field label="Run">
            <code className="font-mono">{run.id}</code>
          </Field>
          <Field label="Scenario">
            <a href={`/scenarios/${run.scenario_id}`} className="text-primary hover:underline">
              {run.scenario_id}
            </a>
          </Field>
          <Field label="Seed">
            <span data-testid="run-record-seed">{run.seed}</span>
          </Field>
          <Field label="Status">{run.status}</Field>
          <Field label="Created">{new Date(run.created_at).toLocaleString()}</Field>
        </dl>
        {run.outputs_deleted_at ? (
          <p className="text-text-secondary mb-4 text-sm">
            Outputs deleted — use Regenerate to recreate this exact dataset.
          </p>
        ) : (
          <p className="mb-4 text-sm">
            <a href={`/api/v1/runs/${run.id}/report`} className="text-primary hover:underline">
              Realism report
            </a>{" "}
            ·{" "}
            <a href={`/runs/${run.id}/exports`} className="text-primary hover:underline">
              Exports
            </a>
          </p>
        )}
        <Button variant="secondary" onClick={() => void regenerate()} loading={regenerating}>
          {regenerating ? "Regenerating…" : "Regenerate exactly this dataset"}
        </Button>
      </CardBody>
    </Card>
  );
}
