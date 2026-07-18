import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { StatusBadge, streamStateTone } from "../../components/ui/status-badge.js";
import { cn } from "../../lib/cn.js";
import type { StreamState } from "./stream-state.js";

interface StreamRow {
  id: string;
  run_id: string;
  state: StreamState;
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

function Metric({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div
      className={cn(
        "border-border rounded-xl border px-4 py-3",
        active && "border-danger/40 bg-danger/5",
      )}
    >
      <p className="text-text-secondary text-xs font-medium">{label}</p>
      <p className="text-text mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

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

  if (!stream) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-secondary text-sm">Loading stream…</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Radio className="text-primary h-5 w-5" aria-hidden="true" />
            Stream for run <code className="font-mono text-base font-normal">{runId}</code>
          </CardTitle>
          <p
            data-testid="stream-state"
            className="text-text-secondary mt-1 flex items-center gap-2 text-sm"
          >
            state: <StatusBadge tone={streamStateTone(stream.state)}>{stream.state}</StatusBadge>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            data-testid="stream-pause"
            onClick={() => void control("pause")}
            disabled={stream.state !== "streaming"}
          >
            Pause
          </Button>
          <Button
            variant="secondary"
            data-testid="stream-resume"
            onClick={() => void control("resume")}
            disabled={stream.state !== "paused"}
          >
            Resume
          </Button>
          <Button
            variant="secondary"
            data-testid="stream-stop"
            onClick={() => void control("stop")}
            disabled={stream.state === "stopped"}
          >
            Stop
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        <div className="grid gap-3 sm:grid-cols-3" data-testid="stream-dial">
          <Metric
            label="Throughput"
            value={`${achievedTps.toFixed(1)} / ${stream.target_tps} tps`}
          />
          <Metric label="Sink lag" value={`${sinkLag}ms`} />
          <div
            data-testid="stream-backpressure"
            className={backpressure ? "backpressure-active" : ""}
          >
            <Metric
              label="Backpressure"
              value={backpressure ? "yes" : "no"}
              active={backpressure}
            />
          </div>
          <span className="sr-only" data-testid="stream-achieved-tps">
            achieved {achievedTps.toFixed(1)} / target {stream.target_tps} tps
          </span>
          <span className="sr-only" data-testid="stream-sink-lag">
            sink lag: {sinkLag}ms
          </span>
        </div>

        <form onSubmit={(e) => void submitRate(e)} className="mt-4 flex items-end gap-3">
          <div className="max-w-[160px]">
            <label htmlFor="stream-rate-input" className="text-text-secondary text-xs font-medium">
              target tps
            </label>
            <Input
              id="stream-rate-input"
              data-testid="stream-rate-input"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <Button type="submit" variant="secondary" data-testid="stream-set-rate">
            Set rate
          </Button>
        </form>

        <h3 className="text-text mt-6 mb-2 text-sm font-semibold">Live events</h3>
        <ul
          className="flex max-h-80 flex-col gap-1.5 overflow-y-auto"
          data-testid="stream-ticker"
          aria-live="polite"
        >
          {ticker.map((event) => (
            <li
              key={event.event_id}
              className="border-border text-text-secondary rounded-lg border px-3 py-2 text-xs tabular-nums"
            >
              {event.ts} — {event.type} {event.amount} ({event.consumer_name}
              {event.merchant_name ? ` → ${event.merchant_name}` : ""})
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
