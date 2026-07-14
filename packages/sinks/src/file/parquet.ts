import { mkdir } from "node:fs/promises";
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
