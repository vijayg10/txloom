import { useState } from "react";
import { apiClient } from "../../api/client.js";

type ExportFormat = "csv" | "parquet" | "json";

interface ExportManifest {
  export_id: string;
  file_name: string;
  answer_key_file_name: string | null;
}

/** Export controls (FR-021/022): format selection plus an include-labels
 * toggle. Including labels in the main export requires explicitly
 * acknowledging the warning — the submit button stays disabled until the
 * acknowledgment checkbox is ticked, so a user can't reach the 422 the API
 * would otherwise return. */
export function ExportControls({ runId }: { runId: string }) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [includeLabels, setIncludeLabels] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [manifest, setManifest] = useState<ExportManifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blocked = includeLabels && !acknowledged;

  function toggleIncludeLabels(next: boolean) {
    setIncludeLabels(next);
    if (!next) setAcknowledged(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked) return;
    setError(null);
    try {
      const body: Record<string, unknown> = { format, include_labels: includeLabels };
      if (includeLabels) body.acknowledged_warning = true;
      const created = await apiClient.post<ExportManifest>(`/runs/${runId}/exports`, body);
      setManifest(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "export failed");
    }
  }

  return (
    <form className="export-controls" onSubmit={(e) => void submit(e)}>
      <label>
        Format
        <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
          <option value="csv">CSV</option>
          <option value="parquet">Parquet</option>
          <option value="json">JSON</option>
        </select>
      </label>

      <label>
        <input
          type="checkbox"
          checked={includeLabels}
          onChange={(e) => toggleIncludeLabels(e.target.checked)}
        />
        Include ground-truth labels in this export
      </label>

      {includeLabels && (
        <div role="alert" className="label-warning">
          <p>
            Merging labels into the main export means downstream consumers can see the answer key
            alongside the data — fraud/typology/actor fields will not be held back in a separate
            file. Only do this if that&apos;s what you intend.
          </p>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I understand labels will be merged into the main export
          </label>
        </div>
      )}

      <button type="submit" disabled={blocked}>
        Export
      </button>

      {error && <p className="export-error">{error}</p>}

      {manifest && (
        <div className="export-result">
          <a href={`/api/v1/runs/${runId}/exports/${manifest.export_id}/download`}>
            Download {manifest.file_name}
          </a>
          {manifest.answer_key_file_name && (
            <p>Answer key exported separately: {manifest.answer_key_file_name}</p>
          )}
        </div>
      )}
    </form>
  );
}
