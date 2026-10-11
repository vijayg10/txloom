import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { ParquetReader, ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import type { SchemaDefinition } from "@dsnp/parquetjs";

export const TRUTH_EVENT_SCHEMA: SchemaDefinition = {
  event_id: { type: "UTF8" },
  ts: { type: "UTF8" },
  type: { type: "UTF8" },
  status: { type: "UTF8" },
  amount: { type: "DOUBLE" },
  currency: { type: "UTF8" },
  consumer_id: { type: "UTF8" },
  consumer_name: { type: "UTF8" },
  merchant_id: { type: "UTF8", optional: true },
  merchant_name: { type: "UTF8", optional: true },
  counterparty_id: { type: "UTF8", optional: true },
  counterparty_name: { type: "UTF8", optional: true },
  channel: { type: "UTF8" },
  partition_no: { type: "INT32" },
};

export const LABEL_RECORD_SCHEMA: SchemaDefinition = {
  event_id: { type: "UTF8" },
  is_fraud: { type: "BOOLEAN" },
  typology: { type: "UTF8", optional: true },
  actor_id: { type: "UTF8", optional: true },
  campaign_step: { type: "INT32", optional: true },
  corruption_type: { type: "UTF8", optional: true },
  corruption_detail: { type: "UTF8", optional: true },
  sink: { type: "UTF8", optional: true },
  delivery_outcome: { type: "UTF8", optional: true },
};

/** A sink's delivered copy: the truth columns plus the delivery fields (contracts/wire-format.md).
 * `ts` is the source's event time; `delivered_at` is the simulated arrival time. */
export const DELIVERED_EVENT_SCHEMA: SchemaDefinition = {
  delivery_id: { type: "UTF8" },
  ...TRUTH_EVENT_SCHEMA,
  delivered_at: { type: "UTF8" },
  sent_at: { type: "UTF8", optional: true },
};

/** Row-group-buffered Parquet write (streaming, flat memory per constitution
 * Principle V) — rows with `null` values for optional fields are passed
 * through as-is; JSON-object fields must be pre-stringified by the caller
 * (see corruption_detail in label-emit.ts consumers). */
export async function writeParquet(
  filePath: string,
  schemaDefinition: SchemaDefinition,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const schema = new ParquetSchema(schemaDefinition);
  const writer = await ParquetWriter.openFile(schema, filePath);
  try {
    for await (const row of rows) {
      await writer.appendRow(row);
    }
  } finally {
    await writer.close();
  }
}

/** Rows per Parquet file before `ParquetStreamWriter` rolls over to a new segment. parquetjs
 * keeps about 34 KB of metadata per row group in memory until the file is closed, so one file
 * for a 90-day history would grow memory with run length. 200,000 rows is 20 row groups. */
export const SEGMENT_ROWS = 200_000;

/** `part-3.parquet` → `part-3.1.parquet` (segment 0 keeps the plain name). */
function segmentPath(filePath: string, segment: number): string {
  if (segment === 0) return filePath;
  const ext = path.extname(filePath);
  return `${filePath.slice(0, filePath.length - ext.length)}.${segment}${ext}`;
}

/** Incremental Parquet writer: `open → append(row) → close`. At most one row group
 * (10,000 rows) is buffered, and the output rolls over to a new segment file every
 * `SEGMENT_ROWS` rows, so memory stays flat however long the history is (R8). Writers that are
 * fed the same rows in lockstep (truth and labels) roll over at the same row, so their segments
 * stay aligned file for file. Readers list the directory and see every segment. */
export class ParquetStreamWriter {
  private segment = 0;
  private rowsInSegment = 0;

  private constructor(
    private readonly filePath: string,
    private readonly schemaDefinition: SchemaDefinition,
    private readonly segmentRows: number,
    private writer: ParquetWriter | null,
  ) {}

  private static async openSegment(
    filePath: string,
    schemaDefinition: SchemaDefinition,
  ): Promise<ParquetWriter> {
    await mkdir(path.dirname(filePath), { recursive: true });
    // No page index: it is optional for readers, and parquetjs keeps every page's index entry
    // in memory until close.
    const writer = await ParquetWriter.openFile(new ParquetSchema(schemaDefinition), filePath, {
      pageIndex: false,
    });
    writer.setRowGroupSize(10_000);
    return writer;
  }

  static async open(
    filePath: string,
    schemaDefinition: SchemaDefinition,
    options: { segmentRows?: number } = {},
  ): Promise<ParquetStreamWriter> {
    // The first segment is created eagerly so an empty output still leaves a valid file.
    const writer = await ParquetStreamWriter.openSegment(filePath, schemaDefinition);
    return new ParquetStreamWriter(
      filePath,
      schemaDefinition,
      options.segmentRows ?? SEGMENT_ROWS,
      writer,
    );
  }

  async append(row: Record<string, unknown>): Promise<void> {
    if (this.writer === null) {
      this.writer = await ParquetStreamWriter.openSegment(
        segmentPath(this.filePath, this.segment),
        this.schemaDefinition,
      );
    }
    await this.writer.appendRow(row);
    if (++this.rowsInSegment >= this.segmentRows) {
      await this.writer.close();
      this.writer = null; // the next segment opens lazily, so there is never an empty trailing file
      this.segment++;
      this.rowsInSegment = 0;
    }
  }

  async close(): Promise<void> {
    await this.writer?.close();
    this.writer = null;
  }
}

/** `part-<partition>[.<segment>].parquet` files of `dir`, in partition then segment order — the
 * order a sink's delivered stream is replayed in. Other files (such as `labels-part-*`) are ignored. */
export async function listPartSegments(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const parsed = names
    .map((name) => ({ name, match: /^part-(\d+)(?:\.(\d+))?\.parquet$/.exec(name) }))
    .filter((entry) => entry.match !== null)
    .map((entry) => ({
      name: entry.name,
      partition: Number(entry.match![1]),
      segment: Number(entry.match![2] ?? 0),
    }));
  parsed.sort((a, b) => a.partition - b.partition || a.segment - b.segment);
  return parsed.map((entry) => path.join(dir, entry.name));
}

/** Row count from the Parquet footer, without reading any rows. */
export async function countParquetRows(filePath: string): Promise<number> {
  const reader = await ParquetReader.openFile(filePath);
  try {
    return Number(reader.getRowCount());
  } finally {
    await reader.close();
  }
}

/** Streams rows back out of a Parquet file, row by row. */
export async function* readParquet(filePath: string): AsyncGenerator<Record<string, unknown>> {
  const reader = await ParquetReader.openFile(filePath);
  try {
    for await (const row of reader) {
      yield row as Record<string, unknown>;
    }
  } finally {
    await reader.close();
  }
}
