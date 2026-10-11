import { useEffect, useRef, useState } from "react";
import {
  apiClient,
  ApiError,
  createApiClient,
  type RunDelivery,
  type RunPhase,
} from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { StatusBadge, runStatusTone } from "../../components/ui/status-badge.js";
import type { RunStatus } from "./run-status.js";

interface RunRow {
  id: string;
  status: RunStatus;
  seed: string;
  error?: string | null;
  phase?: RunPhase;
  deliveries?: RunDelivery[];
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

function deliveryTone(state: RunDelivery["state"]): "success" | "danger" | "warning" | "neutral" {
  if (state === "done") return "success";
  if (state === "failed") return "danger";
  if (state === "running") return "warning";
  return "neutral";
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
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const client = createApiClient();

  // A failed run explains itself: which partitions ran out of attempts, and why.
  useEffect(() => {
    if (run?.status !== "failed") return;
    apiClient
      .get<{ logs: PartitionLog[] }>(`/runs/${runId}/logs`)
      .then((res) => setPartitionLogs(res.logs))
      .catch(() => setPartitionLogs([]));
  }, [runId, run?.status]);

  useEffect(() => {
    client
      .getRun(runId)
      .then((loaded) => setRun(loaded as unknown as RunRow))
      .catch(() => setRun(null));

    // The mock adapter has no socket to connect to.
    if (import.meta.env.VITE_TXLOOM_MOCK === "1") return;

    const ws = new WebSocket(`${window.location.origin.replace(/^http/, "ws")}/api/v1/ws`);
    wsRef.current = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ subscribe: `runs/${runId}/progress` }));
    });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data as string) as {
        status?: string;
        phase?: RunPhase;
        deliveries?: Pick<RunDelivery, "sink" | "state" | "published" | "failed" | "total">[];
      } & Partial<PartitionTick>;
      if (data.phase) {
        // The socket carries progress only; a changed state is refetched for its error text.
        setRun((prev) => (prev ? { ...prev, phase: data.phase! } : prev));
        client
          .getRun(runId)
          .then((loaded) =>
            setRun((prev) => (prev ? { ...prev, deliveries: loaded.deliveries } : prev)),
          )
          .catch(() => {});
      } else if (data.status) {
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

  /** Retries or skips a failed history replay, then refreshes the rows. */
  async function decide(action: "retry" | "skip", sink: string) {
    setDeliveryError(null);
    try {
      if (action === "retry") await client.retryDelivery(runId, sink);
      else await client.skipDelivery(runId, sink);
      const refreshed = await client.getRun(runId);
      setRun((prev) => (prev ? { ...prev, deliveries: refreshed.deliveries } : prev));
    } catch (err) {
      setDeliveryError(err instanceof Error ? err.message : `${action} failed`);
    }
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
        {(run.deliveries?.length ?? 0) > 0 && (
          <div data-testid="run-deliveries" className="mb-4 flex flex-col gap-2">
            <p className="text-text-secondary text-xs font-medium">History replay</p>
            {run.deliveries!.map((delivery) => (
              <div
                key={delivery.sink}
                data-testid={`delivery-row-${delivery.sink}`}
                className="border-border rounded-xl border px-3.5 py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-text font-medium">
                    {delivery.sink}
                    {delivery.destination_snapshot?.connection_name
                      ? ` → ${delivery.destination_snapshot.connection_name}`
                      : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge tone={deliveryTone(delivery.state)}>{delivery.state}</StatusBadge>
                    <span className="text-text-secondary tabular-nums">
                      {delivery.published.toLocaleString()} / {delivery.total.toLocaleString()}
                      {delivery.failed > 0 ? `, ${delivery.failed.toLocaleString()} failed` : ""}
                    </span>
                  </span>
                </div>
                {delivery.total > 0 && (
                  <progress
                    className="mt-2 h-1.5 w-full"
                    value={delivery.published}
                    max={delivery.total}
                    aria-label={`${delivery.sink} replay progress`}
                  />
                )}
                {delivery.state === "failed" && (
                  <div className="mt-2">
                    {delivery.last_error && (
                      <p className="text-danger text-xs">{delivery.last_error}</p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <Button
                        data-testid={`delivery-retry-${delivery.sink}`}
                        onClick={() => void decide("retry", delivery.sink)}
                      >
                        Retry
                      </Button>
                      <Button
                        variant="secondary"
                        data-testid={`delivery-skip-${delivery.sink}`}
                        onClick={() => void decide("skip", delivery.sink)}
                      >
                        Skip
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {deliveryError && (
              <p role="alert" className="text-danger text-sm">
                {deliveryError}
              </p>
            )}
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
