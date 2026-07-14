import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface ExportManifest {
  export_id: string;
  file_name: string;
  answer_key_file_name: string | null;
}

export const exportCommand: Command = {
  name: "export",
  description:
    "Export a run's data: txloom export <run_id> [--format csv|parquet|json] [--include-labels]",
  async run(args) {
    const [runId, ...rest] = args;
    if (!runId)
      throw new Error(
        "Usage: txloom export <run_id> [--format csv|parquet|json] [--include-labels]",
      );

    const formatFlagIndex = rest.indexOf("--format");
    const format = formatFlagIndex >= 0 ? rest[formatFlagIndex + 1] : "csv";
    const includeLabels = rest.includes("--include-labels");

    const client = new ApiClient();
    const body: Record<string, unknown> = { format, include_labels: includeLabels };
    if (includeLabels) body.acknowledged_warning = true;

    const manifest = await client.post<ExportManifest>(`/runs/${runId}/exports`, body);
    console.log(`export ${manifest.export_id}: ${manifest.file_name}`);
    if (manifest.answer_key_file_name) {
      console.log(`answer key: ${manifest.answer_key_file_name}`);
    }
  },
};
