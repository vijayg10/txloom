import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SimulationSpec } from "@txloom/spec";
import { ENGINE_VERSION } from "@txloom/engine";

const API_URL = process.env.TXLOOM_API_URL ?? "http://localhost:3000/api/v1";

/** The reference spec of R18 / plan.md § Scale/Scope: every typology and every imperfection
 * on, scaled by `consumers` and `days`. */
export function referenceSpec(
  options: {
    consumers?: number;
    merchants?: number;
    days?: number;
    typologies?: SimulationSpec["fraud"]["typologies"];
  } = {},
): SimulationSpec {
  return {
    seed: 20260101,
    currency: "INR",
    locale: "en-IN",
    channel: "upi",
    clock: { start: "2026-01-01", days: options.days ?? 90 },
    population: {
      consumers: {
        count: options.consumers ?? 200_000,
        archetypes: [
          {
            name: "salaried",
            weight: 0.6,
            income_pattern: {
              kind: "fixed_credit_day",
              day_of_month: 1,
              amount_mean: 50000,
              amount_stddev: 5000,
            },
            spend_rhythm: {
              daily_transaction_count_mean: 2,
              daily_transaction_count_stddev: 1,
              weekend_multiplier: 1.5,
            },
          },
          {
            name: "gig_worker",
            weight: 0.4,
            income_pattern: { kind: "irregular_weekly", amount_mean: 8000, amount_stddev: 2000 },
            spend_rhythm: {
              daily_transaction_count_mean: 3,
              daily_transaction_count_stddev: 1.5,
              weekend_multiplier: 1.2,
            },
          },
        ],
      },
      merchants: {
        count: options.merchants ?? 5_000,
        categories: {
          grocery: {
            name: "grocery",
            weight: 0.5,
            amount_distribution: { kind: "lognormal", mean: 500, stddev: 200 },
          },
          electronics: {
            name: "electronics",
            weight: 0.5,
            amount_distribution: { kind: "lognormal", mean: 5000, stddev: 2000 },
          },
        },
      },
    },
    seasonality: [{ event: "diwali", window: ["2026-01-04", "2026-01-06"], volume_multiplier: 2 }],
    fraud: {
      target_rate: 0.02,
      typologies: options.typologies ?? [
        {
          type: "card_testing",
          share: 0.5,
          params: {
            burst_size_min: 3,
            burst_size_max: 6,
            burst_window_minutes: 5,
            amount_min: 1,
            amount_max: 50,
          },
        },
        { type: "account_takeover", share: 0.3, params: { dormancy_days: 5, drain_step_count: 3 } },
        {
          type: "refund_abuse",
          share: 0.2,
          params: { refund_rate: 0.3, max_refunds_per_actor: 3 },
        },
      ],
    },
    outcomes: { baseline_decline_rate: 0.03 },
    imperfections: {
      duplicate_delivery: { rate: 0.02, sinks: ["archive"] },
      late_arrival: {
        rate: 0.05,
        delay_seconds_mean: 30,
        delay_seconds_stddev: 10,
        sinks: ["archive"],
      },
      out_of_order: { rate: 0.02, sinks: ["archive"] },
      clock_skew: { rate: 0.02, sources: [{ source: "archive", offset_seconds: 60 }] },
    },
    output: {
      sinks: [{ type: "file", name: "archive", format: "parquet" }],
      labels: "separate_export",
    },
  };
}

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${route}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const payload = (await response.json()) as T & {
    error?: { message: string; details?: unknown };
  };
  if (!response.ok) {
    const details = payload.error?.details ? ` ${JSON.stringify(payload.error.details)}` : "";
    throw new Error(
      `${method} ${route} failed: ${payload.error?.message ?? response.status}${details}`,
    );
  }
  return payload;
}

export interface PartitionPerf {
  peak_heap_bytes: number;
  wall_ms: number;
  events: number;
}

export interface BatchResult {
  engine_version: number;
  consumers: number;
  days: number;
  wall_seconds: number;
  events: number;
  events_per_second: number;
  partitions: number;
  /** Highest heap use any generating thread sampled, bytes. */
  peak_thread_heap_bytes: number;
}

/** Launches `spec` through the API — BullMQ and the worker pool, exactly as users do — waits
 * for the run to finish and reads each partition's perf record from the shared data dir. */
export async function runThroughApi(
  spec: SimulationSpec,
  dataDir: string,
  timeoutMs: number,
): Promise<BatchResult> {
  const scenario = await api<{ id: string }>("POST", "/scenarios", {
    name: `bench-${Date.now()}`,
    currency: spec.currency,
  });
  await api("POST", `/scenarios/${scenario.id}/versions`, { spec });
  const startedAt = Date.now();
  const run = await api<{ id: string; partition_count: number }>(
    "POST",
    `/scenarios/${scenario.id}/runs`,
    {},
  );

  for (;;) {
    const status = await api<{ status: string; error: string | null }>("GET", `/runs/${run.id}`);
    if (status.status === "completed") break;
    if (status.status === "failed") throw new Error(`run failed: ${status.error}`);
    if (Date.now() - startedAt > timeoutMs)
      throw new Error(`run did not finish in ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const wallSeconds = (Date.now() - startedAt) / 1000;

  const truthDir = path.join(dataDir, "runs", run.id, "truth");
  const perfs: PartitionPerf[] = [];
  for (const file of (await readdir(truthDir)).filter((f) => f.endsWith(".perf.json"))) {
    perfs.push(JSON.parse(await readFile(path.join(truthDir, file), "utf-8")) as PartitionPerf);
  }
  const events = perfs.reduce((sum, p) => sum + p.events, 0);
  return {
    engine_version: ENGINE_VERSION,
    consumers: spec.population.consumers.count,
    days: spec.clock.days,
    wall_seconds: wallSeconds,
    events,
    events_per_second: events / wallSeconds,
    partitions: run.partition_count,
    peak_thread_heap_bytes: Math.max(...perfs.map((p) => p.peak_heap_bytes)),
  };
}

export async function writeResult(name: string, result: unknown): Promise<string> {
  const dir = path.join(import.meta.dirname, "..", "results");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}-${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(file, JSON.stringify(result, null, 2) + "\n");
  return file;
}

export async function scratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "txloom-bench-"));
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
