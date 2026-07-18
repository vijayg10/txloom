import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { FormField } from "../../components/ui/form-field.js";
import { Select } from "../../components/ui/select.js";

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
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div className="max-w-xs">
        <FormField label="Format">
          <Select
            data-testid="export-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <option value="csv">CSV</option>
            <option value="parquet">Parquet</option>
            <option value="json">JSON</option>
          </Select>
        </FormField>
      </div>

      <label className="text-text flex cursor-pointer items-center gap-2.5 text-sm">
        <Checkbox
          data-testid="export-include-labels"
          checked={includeLabels}
          onCheckedChange={(checked) => toggleIncludeLabels(checked === true)}
        />
        Include ground-truth labels in this export
      </label>

      {includeLabels && (
        <div
          role="alert"
          data-testid="export-label-warning"
          className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3"
        >
          <p className="text-text flex gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              Merging labels into the main export means downstream consumers can see the answer key
              alongside the data — fraud/typology/actor fields will not be held back in a separate
              file. Only do this if that&apos;s what you intend.
            </span>
          </p>
          <label className="text-text flex cursor-pointer items-center gap-2.5 pl-6 text-sm">
            <Checkbox
              data-testid="export-acknowledge-warning"
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
            />
            I understand labels will be merged into the main export
          </label>
        </div>
      )}

      <div>
        <Button type="submit" data-testid="export-submit" disabled={blocked}>
          Export
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {manifest && (
        <div
          data-testid="export-result"
          className="border-border bg-hover rounded-xl border px-4 py-3 text-sm"
        >
          <a
            data-testid="export-download-link"
            href={`/api/v1/runs/${runId}/exports/${manifest.export_id}/download`}
            className="text-primary hover:underline"
          >
            Download {manifest.file_name}
          </a>
          {manifest.answer_key_file_name && (
            <p data-testid="export-answer-key-name" className="text-text-secondary mt-1">
              Answer key exported separately: {manifest.answer_key_file_name}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
