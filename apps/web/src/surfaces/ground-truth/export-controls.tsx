import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  createApiClient,
  type ExportFormat,
  type ExportManifest,
  type ExportSource,
} from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { FormField } from "../../components/ui/form-field.js";
import { Select } from "../../components/ui/select.js";

/** The `<select>` value for an export source: `truth`, or `sink:<name>`. */
function sourceValue(source: ExportSource): string {
  return source.kind === "truth" ? "truth" : `sink:${source.name}`;
}

function sourceFromValue(value: string): ExportSource {
  return value.startsWith("sink:")
    ? { kind: "sink", name: value.slice("sink:".length) }
    : { kind: "truth" };
}

/** Export controls (FR-021/022, R19): source (the truth store, or a file sink's delivered copy),
 * format, and an include-labels toggle. Including labels in the main export requires explicitly
 * acknowledging the warning — the submit button stays disabled until the acknowledgment checkbox
 * is ticked, so a user can't reach the 422 the API would otherwise return. Exports are built by
 * a worker job, so the status is polled and the download link appears only once it is
 * `completed`. */
export function ExportControls({ runId, pollMs = 1000 }: { runId: string; pollMs?: number }) {
  const api = useMemo(() => createApiClient(), []);
  const [fileSinks, setFileSinks] = useState<string[]>([]);
  const [source, setSource] = useState("truth");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [includeLabels, setIncludeLabels] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [manifest, setManifest] = useState<ExportManifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blocked = includeLabels && !acknowledged;

  // The source defaults to the first file sink the run's spec declares, else the truth store.
  useEffect(() => {
    let cancelled = false;
    api
      .getRun(runId)
      .then((run) => {
        if (cancelled) return;
        const sinks =
          (run.spec_snapshot as { output?: { sinks?: { type: string; name: string }[] } } | null)
            ?.output?.sinks ?? [];
        const names = sinks.filter((sink) => sink.type === "file").map((sink) => sink.name);
        setFileSinks(names);
        if (names[0]) setSource(`sink:${names[0]}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, runId]);

  // Poll the export job until it finishes.
  useEffect(() => {
    if (!manifest || manifest.status === "completed" || manifest.status === "failed") return;
    const timer = setTimeout(() => {
      api
        .getExport(runId, manifest.export_id)
        .then(setManifest)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "export failed"));
    }, pollMs);
    return () => clearTimeout(timer);
  }, [api, manifest, pollMs, runId]);

  function toggleIncludeLabels(next: boolean) {
    setIncludeLabels(next);
    if (!next) setAcknowledged(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked) return;
    setError(null);
    try {
      const created = await api.createExport(runId, {
        format,
        include_labels: includeLabels,
        ...(includeLabels ? { acknowledged_warning: true } : {}),
        source: sourceFromValue(source),
      });
      setManifest(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "export failed");
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div className="max-w-xs">
        <FormField label="Source">
          <Select
            data-testid="export-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="truth">Truth</option>
            {fileSinks.map((name) => (
              <option key={name} value={sourceValue({ kind: "sink", name })}>
                {name} (file sink)
              </option>
            ))}
          </Select>
        </FormField>
      </div>

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

      {manifest && manifest.status !== "completed" && manifest.status !== "failed" && (
        <p data-testid="export-status" role="status" className="text-text-secondary text-sm">
          {manifest.status === "queued" ? "Export queued…" : "Building export…"}
        </p>
      )}

      {manifest?.status === "failed" && (
        <p data-testid="export-status" role="alert" className="text-danger text-sm">
          Export failed: {manifest.error ?? "unknown error"}
        </p>
      )}

      {manifest?.status === "completed" && (
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
