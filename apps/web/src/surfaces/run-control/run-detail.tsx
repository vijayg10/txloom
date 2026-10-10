import { useEffect, useRef, useState } from "react";
import { apiClient, ApiError } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { StatusBadge, runStatusTone } from "../../components/ui/status-badge.js";
import type { RunStatus } from "./run-status.js";

interface RunRow {
  id: string;
  status: RunStatus;
  seed: string;
  error?: string | null;
}

interface PartitionLog {
  partition_no: number;
  state: string;
  attempts: number;
  last_error: string | null;
}

interface PartitionTick {
  partition_no: number;
  state: string;
  events_generated: number;
  throughput: number;
  eta: number | null;
}

/** Run detail: status, per-partition progress bars, throughput, ETA, logs,
 * pause/cancel controls (FR-032) — live-updated over the runs/:id/progress
 * WS channel. */
export function RunDetail({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [ticks, setTicks] = useState<Record<number, PartitionTick>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const [partitionLogs, setPartitionLogs] = useState<PartitionLog[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // A failed run explains itself: which partitions ran out of attempts, and why.
  useEffect(() => {
    if (run?.status !== "failed") return;
    apiClient
      .get<{ logs: PartitionLog[] }>(`/runs/${runId}/logs`)
      .then((res) => setPartitionLogs(res.logs))
      .catch(() => setPartitionLogs([]));
  }, [runId, run?.status]);

  useEffect(() => {
    apiClient
      .get<RunRow>(`/runs/${runId}`)
      .then(setRun)
      .catch(() => setRun(null));

    const ws = new WebSocket(`${window.location.origin.replace(/^http/, "ws")}/api/v1/ws`);
    wsRef.current = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ subscribe: `runs/${runId}/progress` }));
    });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data as string) as { status?: string } & Partial<PartitionTick>;
      if (data.status) {
        setRun((prev) => (prev ? { ...prev, status: data.status as RunStatus } : prev));
      } else if (data.partition_no !== undefined) {
        setTicks((prev) => ({ ...prev, [data.partition_no!]: data as PartitionTick }));
      }
    });
    return () => ws.close();
  }, [runId]);

  async function control(action: "pause" | "resume" | "cancel") {
    const updated = await apiClient.post<RunRow>(`/runs/${runId}/${action}`);
    setRun(updated);
  }

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    try {
      setRun(await apiClient.post<RunRow>(`/runs/${runId}/retry`));
    } catch (err) {
      setRetryError(
        err instanceof ApiError && err.code === "engine_version_mismatch"
          ? "This run was made by another engine version. Use Regenerate instead."
          : err instanceof Error
            ? err.message
            : "Retry failed",
      );
    } finally {
      setRetrying(false);
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
    <Card>
      <CardHeader>
        <div>
          <CardTitle>
            Run <code className="font-mono text-base font-normal">{run.id}</code>
          </CardTitle>
          <p
            data-testid="run-status"
            className="text-text-secondary mt-1 flex items-center gap-2 text-sm"
          >
            status: <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void control("pause")}
            disabled={run.status !== "running"}
          >
            Pause
          </Button>
          <Button
            variant="secondary"
            onClick={() => void control("resume")}
            disabled={run.status !== "paused"}
          >
            Resume
          </Button>
          <Button
            variant="secondary"
            onClick={() => void control("cancel")}
            disabled={run.status === "completed" || run.status === "cancelled"}
          >
            Cancel
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        {run.status === "failed" && (
          <div data-testid="run-failure" className="border-danger/40 mb-4 rounded-xl border p-3.5">
            <p className="text-danger text-sm font-medium">This run failed.</p>
            {run.error && (
              <p data-testid="run-last-error" className="text-text-secondary mt-1 text-sm">
                {run.error}
              </p>
            )}
            <ul className="mt-2 flex flex-col gap-1" data-testid="run-partition-attempts">
              {partitionLogs
                .filter((p) => p.state !== "done")
                .map((p) => (
                  <li key={p.partition_no} className="text-text-secondary text-xs tabular-nums">
                    partition {p.partition_no}: {p.state}, {p.attempts}{" "}
                    {p.attempts === 1 ? "attempt" : "attempts"}
                    {p.last_error ? ` — ${p.last_error}` : ""}
                  </li>
                ))}
            </ul>
            <div className="mt-3">
              <Button data-testid="run-retry" onClick={() => void retry()} loading={retrying}>
                Retry failed partitions
              </Button>
              {retryError && (
                <p role="alert" className="text-danger mt-2 text-sm">
                  {retryError}
                </p>
              )}
            </div>
          </div>
        )}
        <ul className="flex flex-col gap-2" data-testid="run-progress" aria-live="polite">
          {Object.values(ticks)
            .sort((a, b) => a.partition_no - b.partition_no)
            .map((tick) => (
              <li
                key={tick.partition_no}
                className="border-border text-text-secondary rounded-xl border px-3.5 py-2.5 text-sm tabular-nums"
              >
                partition {tick.partition_no}: {tick.state} —{" "}
                {tick.events_generated.toLocaleString()} events ({tick.throughput.toFixed(0)}/s
                {tick.eta !== null ? `, ${tick.eta} partitions remaining` : ""})
              </li>
            ))}
        </ul>
      </CardBody>
    </Card>
  );
}
