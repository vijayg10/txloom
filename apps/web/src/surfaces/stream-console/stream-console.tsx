import { useEffect, useRef, useState } from "react";
import { apiClient } from "../../api/client.js";

interface StreamRow {
  id: string;
  run_id: string;
  state: "idle" | "streaming" | "paused" | "stopped";
  target_tps: number;
  label_channel_enabled: boolean;
}

interface TickerEvent {
  event_id: string;
  ts: string;
  type: string;
  amount: number;
  consumer_name: string;
  merchant_name: string | null;
}

interface StreamMetricsMessage {
  achieved_tps?: number;
  target_tps?: number;
  sink_lag?: number;
  backpressure?: boolean;
  ticker?: TickerEvent;
  state?: StreamRow["state"];
}

const TICKER_LIMIT = 20;

/** Stream console (FR-028/036 §3): rate dial, live achieved-vs-target
 * throughput, sink lag/backpressure indicators, real-time event ticker —
 * live-updated over the `runs/:id/stream` WS channel. */
export function StreamConsole({ runId }: { runId: string }) {
  const [stream, setStream] = useState<StreamRow | null>(null);
  const [achievedTps, setAchievedTps] = useState(0);
  const [sinkLag, setSinkLag] = useState(0);
  const [backpressure, setBackpressure] = useState(false);
  const [ticker, setTicker] = useState<TickerEvent[]>([]);
  const [rateInput, setRateInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    apiClient
      .get<StreamRow>(`/runs/${runId}/stream`)
      .then((row) => {
        setStream(row);
        setRateInput(String(row.target_tps));
      })
      .catch(() => setStream(null));

    const ws = new WebSocket(`${window.location.origin.replace(/^http/, "ws")}/api/v1/ws`);
    wsRef.current = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ subscribe: `runs/${runId}/stream` }));
    });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data as string) as StreamMetricsMessage;
      if (data.state) {
        setStream((prev) => (prev ? { ...prev, state: data.state! } : prev));
      }
      if (data.achieved_tps !== undefined) setAchievedTps(data.achieved_tps);
      if (data.target_tps !== undefined) {
        setStream((prev) => (prev ? { ...prev, target_tps: data.target_tps! } : prev));
      }
      if (data.sink_lag !== undefined) setSinkLag(data.sink_lag);
      if (data.backpressure !== undefined) setBackpressure(data.backpressure);
      if (data.ticker) {
        setTicker((prev) => [data.ticker!, ...prev].slice(0, TICKER_LIMIT));
      }
    });
    return () => ws.close();
  }, [runId]);

  async function control(action: "pause" | "resume" | "stop") {
    const updated = await apiClient.post<StreamRow>(`/runs/${runId}/stream/${action}`);
    setStream(updated);
  }

  async function submitRate(e: React.FormEvent) {
    e.preventDefault();
    const target_tps = Number(rateInput);
    if (!Number.isFinite(target_tps) || target_tps <= 0) return;
    const updated = await apiClient.patch<StreamRow>(`/runs/${runId}/stream`, { target_tps });
    setStream(updated);
  }

  if (!stream) return <p>Loading stream…</p>;

  return (
    <div className="stream-console">
      <h2>
        Stream for run <code>{runId}</code>
      </h2>
      <p data-testid="stream-state">state: {stream.state}</p>

      <div className="stream-dial" data-testid="stream-dial">
        <span data-testid="stream-achieved-tps">
          achieved {achievedTps.toFixed(1)} / target {stream.target_tps} tps
        </span>
        <span data-testid="stream-sink-lag">sink lag: {sinkLag}ms</span>
        <span
          data-testid="stream-backpressure"
          className={backpressure ? "backpressure-active" : ""}
        >
          backpressure: {backpressure ? "yes" : "no"}
        </span>
      </div>

      <form onSubmit={(e) => void submitRate(e)}>
        <label>
          target tps
          <input
            data-testid="stream-rate-input"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
          />
        </label>
        <button type="submit" data-testid="stream-set-rate">
          Set rate
        </button>
      </form>

      <div className="stream-controls">
        <button
          type="button"
          data-testid="stream-pause"
          onClick={() => void control("pause")}
          disabled={stream.state !== "streaming"}
        >
          Pause
        </button>
        <button
          type="button"
          data-testid="stream-resume"
          onClick={() => void control("resume")}
          disabled={stream.state !== "paused"}
        >
          Resume
        </button>
        <button
          type="button"
          data-testid="stream-stop"
          onClick={() => void control("stop")}
          disabled={stream.state === "stopped"}
        >
          Stop
        </button>
      </div>

      <ul className="stream-ticker" data-testid="stream-ticker">
        {ticker.map((event) => (
          <li key={event.event_id}>
            {event.ts} — {event.type} {event.amount} ({event.consumer_name}
            {event.merchant_name ? ` → ${event.merchant_name}` : ""})
          </li>
        ))}
      </ul>
    </div>
  );
}
