import { readdir } from "node:fs/promises";
import path from "node:path";
import { readParquet } from "@txloom/sinks";
import type { TruthEvent, LabelRecord } from "@txloom/engine";

async function listParquetFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".parquet"));
  } catch {
    return [];
  }
}

/** Loads every truth-event Parquet segment for a run into memory. v1 scans
 * files directly (same approach as truth-events.ts); a query-optimized index
 * is a documented follow-up for larger runs. */
export async function loadRunTruthEvents(dataDir: string, runId: string): Promise<TruthEvent[]> {
  const truthDir = path.join(dataDir, "runs", runId, "truth");
  const events: TruthEvent[] = [];
  for (const file of await listParquetFiles(truthDir)) {
    for await (const row of readParquet(path.join(truthDir, file))) {
      events.push(row as unknown as TruthEvent);
    }
  }
  return events;
}

export async function loadRunLabels(dataDir: string, runId: string): Promise<LabelRecord[]> {
  const labelsDir = path.join(dataDir, "runs", runId, "labels");
  const labels: LabelRecord[] = [];
  for (const file of await listParquetFiles(labelsDir)) {
    for await (const row of readParquet(path.join(labelsDir, file))) {
      labels.push(row as unknown as LabelRecord);
    }
  }
  return labels;
}

/** Every imperfection label and delivery-failure label for a run (data-model.md §3):
 * `corruptions/<sink>/*` plus `deliveries/<sink>/dropped-*`. The fraud answer key stays in
 * `labels/` (see `loadRunLabels`). Optionally limited to one sink. */
export async function loadRunCorruptionLabels(
  dataDir: string,
  runId: string,
  sink?: string,
): Promise<LabelRecord[]> {
  const runDir = path.join(dataDir, "runs", runId);
  const labels: LabelRecord[] = [];
  for (const group of ["corruptions", "deliveries"]) {
    const groupDir = path.join(runDir, group);
    let sinks: string[];
    try {
      sinks = await readdir(groupDir);
    } catch {
      continue;
    }
    for (const sinkName of sinks) {
      if (sink && sinkName !== sink) continue;
      const dir = path.join(groupDir, sinkName);
      for (const file of await listParquetFiles(dir)) {
        for await (const row of readParquet(path.join(dir, file))) {
          labels.push(row as unknown as LabelRecord);
        }
      }
    }
  }
  return labels;
}
