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
