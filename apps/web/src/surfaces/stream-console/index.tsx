import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { FormField } from "../../components/ui/form-field.js";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { apiClient, ApiError } from "../../api/client.js";
import { PageHeader } from "../../components/layout/page-header.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import type { RunStatus } from "../run-control/run-status.js";
import { StreamConsole } from "./stream-console.js";

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

/** Starts the live phase into the destinations the run was launched with — no sink is
 * entered here (the inline form was removed with `/sinks`). */
function StreamStart({ runId, onStarted }: { runId: string; onStarted: () => void }) {
  const [targetTps, setTargetTps] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setStarting(true);
    setError(null);
    try {
      await apiClient.post(`/runs/${runId}/stream/start`, {
        ...(targetTps ? { target_tps: Number(targetTps) } : {}),
      });
      onStarted();
    } catch (err) {
      // stream_paused and stream_limit carry their own remedy ("Resume it, or stop it first…",
      // "Stop one, or raise the limit"), so the server's message is shown as written.
      setError(err instanceof Error ? err.message : "failed to start stream");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start stream</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={(e) => void start(e)} className="flex flex-col gap-4">
          <p className="text-text-secondary text-sm">
            Events go to the destinations this run was launched with.
          </p>
          <div className="max-w-xs">
            <FormField label="Target TPS" hint="Leave blank to use the spec's rate">
              <Input
                data-testid="stream-target-tps"
                type="number"
                value={targetTps}
                onChange={(e) => setTargetTps(e.target.value)}
              />
            </FormField>
          </div>
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" data-testid="stream-start-button" loading={starting}>
              Start stream
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
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
          <StreamStart runId={runId} onStarted={() => setHasStream(true)} />
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
