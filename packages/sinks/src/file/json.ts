import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/** Streams rows to a JSON-array file (`[{...},{...}]`) — row-by-row, never
 * buffering the whole dataset in memory. */
export async function writeJson(
  filePath: string,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { encoding: "utf-8" });

  let first = true;
  try {
    stream.write("[\n");
    for await (const row of rows) {
      stream.write((first ? "" : ",\n") + JSON.stringify(row));
      first = false;
    }
    stream.write("\n]\n");
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.end((err: unknown) => (err ? reject(err as Error) : resolve()));
    });
  }
}
