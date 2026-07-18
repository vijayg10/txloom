import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { REPO_ROOT } from "./compose.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const READER_SCRIPT = path.join(__dirname, "parquet-reader-cli.ts");
const E2E_PACKAGE_DIR = path.join(REPO_ROOT, "apps/e2e");

/** The host's `./data` bind mount (data-model.md § Sink Verification Target)
 * — read the same way an operator or analyst would, never through the API. */
export const DATA_DIR = path.join(REPO_ROOT, "data");

export function runDir(runId: string): string {
  return path.join(DATA_DIR, "runs", runId);
}

/** Reads every `.parquet` file in `dir` via an out-of-process reader (see
 * parquet-reader-cli.ts for why). Returns `[]` for a directory that doesn't
 * exist yet (e.g. no events routed to this sink). */
export async function readParquetRows(dir: string): Promise<Record<string, unknown>[]> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", READER_SCRIPT, dir],
    { cwd: E2E_PACKAGE_DIR, maxBuffer: 1024 * 1024 * 64 },
  );
  return JSON.parse(stdout) as Record<string, unknown>[];
}

export function readTruthEvents(runId: string): Promise<Record<string, unknown>[]> {
  return readParquetRows(path.join(runDir(runId), "truth"));
}

export function readDeliveredEvents(
  runId: string,
  sinkName: string,
): Promise<Record<string, unknown>[]> {
  return readParquetRows(path.join(runDir(runId), "delivered", sinkName));
}

export function readLabels(runId: string): Promise<Record<string, unknown>[]> {
  return readParquetRows(path.join(runDir(runId), "labels"));
}
