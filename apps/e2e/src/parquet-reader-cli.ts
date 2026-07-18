import { readdir } from "node:fs/promises";
import path from "node:path";
import { readParquet } from "@txloom/sinks";

/** Standalone entry point, invoked as a child process (see data-dir.ts) —
 * @dsnp/parquetjs pulls in `thrift`, which Playwright's own test loader
 * cannot statically resolve (`uuid`'s dual ESM/CJS layout trips it up even
 * on a bare import, reproduced independent of any suite code). Keeping the
 * parquet read out-of-process keeps that dependency chain out of Playwright's
 * module graph entirely. */
async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: parquet-reader-cli <dir>");

  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".parquet"));
  } catch {
    files = [];
  }

  const rows: Record<string, unknown>[] = [];
  for (const file of files) {
    for await (const row of readParquet(path.join(dir, file))) rows.push(row);
  }
  process.stdout.write(JSON.stringify(rows));
}

void main();
