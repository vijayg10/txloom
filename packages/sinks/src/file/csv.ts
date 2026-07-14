import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Streams rows to a CSV file — row-by-row, never buffering the whole dataset
 * in memory (constitution Principle V: flat memory with respect to run length). */
export async function writeCsv(
  filePath: string,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { encoding: "utf-8" });

  let header: string[] | null = null;
  try {
    for await (const row of rows) {
      if (!header) {
        header = Object.keys(row);
        stream.write(header.join(",") + "\n");
      }
      stream.write(header.map((key) => csvEscape(row[key])).join(",") + "\n");
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.end((err: unknown) => (err ? reject(err as Error) : resolve()));
    });
  }
}
