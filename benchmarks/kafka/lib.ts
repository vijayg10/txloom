import type { SimulationSpec } from "@txloom/spec";
import { referenceSpec } from "../batch/lib.js";

const API_URL = process.env.TXLOOM_API_URL ?? "http://localhost:3000/api/v1";

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The reference spec (every typology and imperfection) delivering to one Kafka sink. */
export function benchmarkSpec(options: { consumers?: number; days?: number } = {}): SimulationSpec {
  const spec = referenceSpec({
    consumers: options.consumers ?? 20_000,
    merchants: 500,
    days: options.days ?? 7,
  });
  spec.output.sinks = [{ type: "kafka", name: "bench" }];
  // Imperfections target the sink they act on.
  for (const config of Object.values(spec.imperfections)) {
    if (config && "sinks" in config) config.sinks = ["bench"];
  }
  for (const source of spec.imperfections.clock_skew?.sources ?? []) source.source = "bench";
  return spec;
}

export interface BenchmarkOptions {
  targetTps: number;
  durationMs: number;
  /** Bootstrap servers as the *worker* reaches them (`kafka:29092` inside the compose network). */
  brokers: string[];
  topic: string;
  consumers?: number;
  days?: number;
}

export interface BenchmarkResult {
  target_tps: number;
  /** Mean of the per-second achieved rates. */
  achieved_tps: number;
  duration_s: number;
  windows: number;
  /** Share of 1-second windows whose achieved rate was within ±5% of the target. */
  fraction_in_band: number;
  /** Each 1-second window's achieved rate. */
  achieved_windows: number[];
  /** RSS of the worker process per window, MB. */
  memory_rss_mb: number[];
  /** Growth of the last quarter's mean RSS over the first quarter's (flat ≈ 0). */
  rss_growth: number;
}

interface StreamView {
  state: string;
  achieved_tps: number;
  worker_rss_bytes?: number;
  delivered_total: number;
  sim_time: string | null;
  last_error: string | null;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * The published Kafka benchmark (SC-010, research R18), driven through the API exactly as a user
 * would: a saved connection, a launched `history_then_live` run, the live stream the worker
 * starts by itself, and the stream's own metrics sampled once a second.
 */
export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const stamp = Date.now();
  const connection = await api<{ id: string }>("POST", "/connections", {
    type: "kafka",
    name: `bench-kafka-${stamp}`,
    config: {
      bootstrap_servers: options.brokers,
      security_protocol: "PLAINTEXT",
      default_topic: options.topic,
    },
  });
  const spec = benchmarkSpec(options);
  spec.clock.then_stream_tps = options.targetTps;
  const scenario = await api<{ id: string }>("POST", "/scenarios", {
    name: `bench-${stamp}`,
    currency: spec.currency,
  });
  await api("POST", `/scenarios/${scenario.id}/versions`, { spec });
  const run = await api<{ id: string }>("POST", `/scenarios/${scenario.id}/runs`, {
    mode: "history_then_live",
    target_tps: options.targetTps,
    destinations: [{ sink: "bench", connection_id: connection.id }],
  });

  // History generates first; the worker then starts live by itself.
  const startDeadline = Date.now() + 30 * 60_000;
  for (;;) {
    const status = await api<{ status: string; error: string | null }>("GET", `/runs/${run.id}`);
    if (status.status === "failed") throw new Error(`run failed: ${status.error}`);
    const stream = await api<StreamView>("GET", `/runs/${run.id}/stream`).catch(() => null);
    if (stream?.state === "streaming") break;
    if (Date.now() > startDeadline) throw new Error("the live stream never started");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const achieved: number[] = [];
  const memoryMb: number[] = [];
  const startedAt = Date.now();
  // Skip the first seconds: the pump and the broker connection warm up.
  const warmupMs = Math.min(15_000, options.durationMs / 10);
  try {
    // The worker reports a fresh 1-second window once a second. Poll faster and take each
    // window once, recognised by its running delivery total moving on.
    let lastDelivered = -1;
    while (Date.now() - startedAt < options.durationMs) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const stream = await api<StreamView>("GET", `/runs/${run.id}/stream`);
      if (stream.state === "error") throw new Error(`stream failed: ${stream.last_error}`);
      if (stream.delivered_total === lastDelivered) continue;
      lastDelivered = stream.delivered_total;
      if (Date.now() - startedAt < warmupMs) continue;
      achieved.push(stream.achieved_tps);
      if (stream.worker_rss_bytes) memoryMb.push(stream.worker_rss_bytes / (1024 * 1024));
    }
  } finally {
    await api("POST", `/runs/${run.id}/stream/stop`).catch(() => {});
  }

  const inBand = achieved.filter(
    (tps) => Math.abs(tps - options.targetTps) <= options.targetTps * 0.05,
  );
  const quarter = Math.max(1, Math.floor(memoryMb.length / 4));
  const first = mean(memoryMb.slice(0, quarter));
  const last = mean(memoryMb.slice(-quarter));
  return {
    target_tps: options.targetTps,
    achieved_tps: mean(achieved),
    duration_s: (Date.now() - startedAt) / 1000,
    windows: achieved.length,
    fraction_in_band: achieved.length ? inBand.length / achieved.length : 0,
    achieved_windows: achieved.map((tps) => Math.round(tps)),
    memory_rss_mb: memoryMb,
    rss_growth: first > 0 ? (last - first) / first : 0,
  };
}
