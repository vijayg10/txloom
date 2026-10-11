import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  type LiveDayCheckpoint,
  type WorldCheckpoint,
} from "@txloom/engine";

/** Live day checkpoints a session keeps (the day being streamed and the one before it). */
const KEEP_DAYS = 2;

export function liveCheckpointDir(dataDir: string, runId: string, sessionId: string): string {
  return path.join(dataDir, "runs", runId, "streams", sessionId);
}

function fileFor(dir: string, partitionNo: number, dayIndex: number): string {
  return path.join(dir, `part-${partitionNo}.day-${dayIndex}.json.gz`);
}

/** Writes the world as it stood before `checkpoint.dayIndex`, one gzipped file per partition with
 * a SHA-256 sidecar, then drops all but the newest two days. */
export async function writeLiveDayCheckpoint(
  dataDir: string,
  runId: string,
  sessionId: string,
  checkpoint: LiveDayCheckpoint,
  options: { prune?: boolean } = {},
): Promise<void> {
  const dir = liveCheckpointDir(dataDir, runId, sessionId);
  await mkdir(dir, { recursive: true });
  await Promise.all(
    checkpoint.partitions.map(async (partition, partitionNo) => {
      const { bytes, sha256 } = encodeCheckpoint(partition);
      const file = fileFor(dir, partitionNo, checkpoint.dayIndex);
      await writeFile(file, bytes);
      await writeFile(`${file}.sha256`, sha256);
    }),
  );
  if (options.prune !== false) await pruneLiveDayCheckpoints(dir);
}

async function pruneLiveDayCheckpoints(dir: string): Promise<void> {
  const days = new Set<number>();
  for (const name of await readdir(dir)) {
    const match = /^part-\d+\.day-(\d+)\.json\.gz/.exec(name);
    if (match) days.add(Number(match[1]));
  }
  const stale = [...days].sort((a, b) => b - a).slice(KEEP_DAYS);
  if (stale.length === 0) return;
  for (const name of await readdir(dir)) {
    const match = /^part-\d+\.day-(\d+)\.json\.gz/.exec(name);
    if (match && stale.includes(Number(match[1]))) await rm(path.join(dir, name), { force: true });
  }
}

/** Reads and verifies every partition's checkpoint for `dayIndex`. */
export async function readLiveDayCheckpoint(
  dataDir: string,
  runId: string,
  sessionId: string,
  dayIndex: number,
  partitionCount: number,
): Promise<WorldCheckpoint[]> {
  const dir = liveCheckpointDir(dataDir, runId, sessionId);
  return Promise.all(
    Array.from({ length: partitionCount }, async (_, partitionNo) => {
      const file = fileFor(dir, partitionNo, dayIndex);
      const [bytes, sha256] = await Promise.all([
        readFile(file),
        readFile(`${file}.sha256`, "utf8"),
      ]);
      return decodeCheckpoint(bytes, sha256.trim());
    }),
  );
}

/** Drops checkpoints older than the day before `currentDay`: the session keeps the day being
 * streamed and the one before it, however far ahead the live thread has written. */
export async function pruneLiveDayCheckpointsBefore(
  dataDir: string,
  runId: string,
  sessionId: string,
  currentDay: number,
): Promise<void> {
  const dir = liveCheckpointDir(dataDir, runId, sessionId);
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const match = /^part-\d+\.day-(\d+)\.json\.gz/.exec(name);
    if (match && Number(match[1]) < currentDay - 1) await rm(path.join(dir, name), { force: true });
  }
}

/** When a session ends, keeps only the day it reached and the one before: days the live thread
 * had already written ahead of delivery are re-simulated on resume, so they are not needed. */
export async function trimLiveDayCheckpoints(
  dataDir: string,
  runId: string,
  sessionId: string,
  lastDay: number,
): Promise<void> {
  const dir = liveCheckpointDir(dataDir, runId, sessionId);
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const match = /^part-\d+\.day-(\d+)\.json\.gz/.exec(name);
    if (match && (Number(match[1]) < lastDay - 1 || Number(match[1]) > lastDay)) {
      await rm(path.join(dir, name), { force: true });
    }
  }
}
