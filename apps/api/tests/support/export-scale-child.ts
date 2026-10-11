// Runs outside the test process so the API's event loop is measured on its own:
//   node --import tsx export-scale-child.ts seed  <dataDir> <runId> <rows>
//   node --import tsx export-scale-child.ts build <dataDir> <runId> <exportId>
import path from "node:path";
import { LABEL_RECORD_SCHEMA, ParquetStreamWriter, TRUTH_EVENT_SCHEMA } from "@txloom/sinks";
import { runExportBuild } from "../../../worker/src/jobs/export-build.js";

const [mode, dataDir, runId, last] = process.argv.slice(2) as [string, string, string, string];

async function seed(rows: number): Promise<void> {
  const runDir = path.join(dataDir, "runs", runId);
  const truth = await ParquetStreamWriter.open(
    path.join(runDir, "truth", "part-0.parquet"),
    TRUTH_EVENT_SCHEMA,
  );
  const labels = await ParquetStreamWriter.open(
    path.join(runDir, "labels", "part-0.parquet"),
    LABEL_RECORD_SCHEMA,
  );
  for (let i = 0; i < rows; i++) {
    const eventId = `e${i}`;
    await truth.append({
      event_id: eventId,
      ts: "2026-01-01T10:00:00.000Z",
      type: "payment",
      status: "approved",
      amount: 10,
      currency: "INR",
      consumer_id: `c${i % 1000}`,
      consumer_name: "Asha",
      merchant_id: "m1",
      merchant_name: "Shop",
      counterparty_id: null,
      counterparty_name: null,
      channel: "upi",
      partition_no: 0,
    });
    await labels.append({
      event_id: eventId,
      is_fraud: false,
      typology: null,
      actor_id: null,
      campaign_step: null,
      corruption_type: null,
      corruption_detail: null,
      sink: null,
      delivery_outcome: null,
    });
  }
  await Promise.all([truth.close(), labels.close()]);
}

if (mode === "seed") await seed(Number(last));
else await runExportBuild({ runId, exportId: last, dataDir });
