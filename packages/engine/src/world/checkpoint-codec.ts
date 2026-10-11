import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorldCheckpoint } from "./partition-world.js";

/** What `run_partitions.rng_checkpoint` stores for a partition's end-of-history world (R7). */
export interface CheckpointRef {
  path: string;
  sha256: string;
  next_day_index: number;
}

export interface EncodedCheckpoint {
  bytes: Buffer;
  sha256: string;
}

/** Gzipped JSON plus the SHA-256 of the gzipped bytes. */
export function encodeCheckpoint(checkpoint: WorldCheckpoint): EncodedCheckpoint {
  const bytes = gzipSync(Buffer.from(JSON.stringify(checkpoint), "utf8"));
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Verifies the digest before touching the contents — a corrupted or edited checkpoint must
 * fail loudly rather than resume a subtly different world. */
export function decodeCheckpoint(bytes: Buffer, expectedSha256: string): WorldCheckpoint {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(
      `World checkpoint failed SHA-256 verification (expected ${expectedSha256}, got ${actual}). The file was modified or corrupted; regenerate the run.`,
    );
  }
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as WorldCheckpoint;
}

export async function writeCheckpointFile(
  filePath: string,
  checkpoint: WorldCheckpoint,
): Promise<CheckpointRef> {
  const { bytes, sha256 } = encodeCheckpoint(checkpoint);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return { path: filePath, sha256, next_day_index: checkpoint.nextDayIndex };
}

export async function readCheckpointFile(ref: CheckpointRef): Promise<WorldCheckpoint> {
  return decodeCheckpoint(await readFile(ref.path), ref.sha256);
}
