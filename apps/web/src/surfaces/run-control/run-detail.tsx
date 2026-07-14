import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../api/client.js";

interface RunRow {
  id: string;
  status: string;
  seed: string;
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
        setRun((prev) => (prev ? { ...prev, status: data.status! } : prev));
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

  if (!run) return <p>Loading…</p>;

  return (
    <div className="run-detail">
      <h2>
        Run <code>{run.id}</code>
      </h2>
      <p>status: {run.status}</p>
      <div className="run-controls">
        <button
          type="button"
          onClick={() => void control("pause")}
          disabled={run.status !== "running"}
        >
          Pause
        </button>
        <button
          type="button"
          onClick={() => void control("resume")}
          disabled={run.status !== "paused"}
        >
          Resume
        </button>
        <button
          type="button"
          onClick={() => void control("cancel")}
          disabled={run.status === "completed" || run.status === "cancelled"}
        >
          Cancel
        </button>
      </div>
      <ul className="partition-progress">
        {Object.values(ticks)
          .sort((a, b) => a.partition_no - b.partition_no)
          .map((tick) => (
            <li key={tick.partition_no}>
              partition {tick.partition_no}: {tick.state} — {tick.events_generated.toLocaleString()}{" "}
              events ({tick.throughput.toFixed(0)}/s
              {tick.eta !== null ? `, ${tick.eta} partitions remaining` : ""})
            </li>
          ))}
      </ul>
    </div>
  );
}
