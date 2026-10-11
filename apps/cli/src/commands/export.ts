import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface ExportManifest {
  export_id: string;
  status: "queued" | "running" | "completed" | "failed";
  file_name: string;
  answer_key_file_name: string | null;
  error?: string;
}

const USAGE =
  "Usage: txloom export <run_id> [--format csv|parquet|json] [--include-labels] [--source truth|<sink>]";

const POLL_MS = 1000;

/** Exports are asynchronous (R19): the POST only queues the job, so the command polls the status
 * until it is `completed` or `failed`, and exits non-zero with the job's error on failure. */
export const exportCommand: Command = {
  name: "export",
  description: `Export a run's data. ${USAGE}`,
  async run(args) {
    const [runId, ...rest] = args;
    if (!runId) throw new Error(USAGE);

    const valueOf = (flag: string) => {
      const index = rest.indexOf(flag);
      return index >= 0 ? rest[index + 1] : undefined;
    };
    const format = valueOf("--format") ?? "csv";
    const includeLabels = rest.includes("--include-labels");
    const source = valueOf("--source");

    const client = new ApiClient();
    const body: Record<string, unknown> = { format, include_labels: includeLabels };
    if (includeLabels) body.acknowledged_warning = true;
    if (source)
      body.source = source === "truth" ? { kind: "truth" } : { kind: "sink", name: source };

    let manifest = await client.post<ExportManifest>(`/runs/${runId}/exports`, body);
    console.log(`export ${manifest.export_id}: ${manifest.status}`);
    while (manifest.status === "queued" || manifest.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      manifest = await client.get<ExportManifest>(`/runs/${runId}/exports/${manifest.export_id}`);
    }

    if (manifest.status === "failed") {
      throw new Error(`export ${manifest.export_id} failed: ${manifest.error ?? "unknown error"}`);
    }
    console.log(`export ${manifest.export_id}: ${manifest.file_name}`);
    if (manifest.answer_key_file_name) {
      console.log(`answer key: ${manifest.answer_key_file_name}`);
    }
  },
};
