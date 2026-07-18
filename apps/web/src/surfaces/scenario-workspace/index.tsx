import { useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import type { SimulationSpec } from "@txloom/spec";
import { apiClient } from "../../api/client.js";
import { SpecEditor } from "./spec-editor.js";
import { StructuralPreview } from "./structural-preview.js";
import { TemplateGallery } from "./template-gallery.js";
import { VersionHistory } from "./version-history.js";

interface ScenarioRow {
  id: string;
  name: string;
  currency: string;
  current_version_id: string | null;
}

interface SpecVersionRow {
  id: string;
  version_no: number;
  spec: unknown;
}

function ScenarioListView() {
  const [scenarios, setScenarios] = useState<ScenarioRow[] | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("INR");
  const navigate = useNavigate();

  useEffect(() => {
    apiClient
      .get<{ scenarios: ScenarioRow[] }>("/scenarios")
      .then((res) => setScenarios(res.scenarios))
      .catch(() => setScenarios([]));
  }, []);

  async function createBlank(e: React.FormEvent) {
    e.preventDefault();
    const scenario = await apiClient.post<ScenarioRow>("/scenarios", { name, currency });
    navigate(`/scenarios/${scenario.id}`);
  }

  return (
    <section>
      <h1>Scenario workspace</h1>
      <ul data-testid="scenario-list">
        {(scenarios ?? []).map((scenario) => (
          <li key={scenario.id}>
            <Link data-testid="scenario-list-item" to={`/scenarios/${scenario.id}`}>
              {scenario.name}
            </Link>
          </li>
        ))}
      </ul>

      <form data-testid="new-scenario-form" onSubmit={(e) => void createBlank(e)}>
        <h2>New blank scenario</h2>
        <label>
          Name
          <input
            data-testid="new-scenario-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Currency
          <input
            data-testid="new-scenario-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            required
          />
        </label>
        <button type="submit" data-testid="create-blank-scenario">
          Create
        </button>
      </form>

      <TemplateGallery onCloned={(scenarioId) => navigate(`/scenarios/${scenarioId}`)} />
    </section>
  );
}

function ScenarioDetailView() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const [scenario, setScenario] = useState<ScenarioRow | null>(null);
  const [initialSpec, setInitialSpec] = useState<object | null>(null);
  const [currentSpec, setCurrentSpec] = useState<SimulationSpec | null>(null);
  const [valid, setValid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scenarioId) return;
    let currentVersionId: string | null = null;
    apiClient
      .get<ScenarioRow>(`/scenarios/${scenarioId}`)
      .then((row) => {
        currentVersionId = row.current_version_id;
        setScenario(row);
      })
      .catch(() => setScenario(null))
      .finally(() => {
        apiClient
          .get<{ versions: SpecVersionRow[] }>(`/scenarios/${scenarioId}/versions`)
          .then((res) => {
            const current =
              res.versions.find((v) => v.id === currentVersionId) ??
              res.versions[res.versions.length - 1];
            setInitialSpec((current?.spec as object | undefined) ?? {});
          })
          .catch(() => setInitialSpec({}));
      });
  }, [scenarioId]);

  async function save() {
    if (!scenarioId || !currentSpec) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await apiClient.post(`/scenarios/${scenarioId}/versions`, { spec: currentSpec });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save spec version");
    } finally {
      setSaving(false);
    }
  }

  if (!scenarioId) return null;

  return (
    <section>
      <h1>{scenario?.name ?? "Scenario"}</h1>

      <div data-testid="spec-editor">
        {initialSpec && (
          <SpecEditor
            initialSpec={initialSpec}
            onValidChange={(spec, isValid) => {
              setCurrentSpec(isValid ? (spec as SimulationSpec) : null);
              setValid(isValid);
              setSaved(false);
            }}
          />
        )}
      </div>

      <div data-testid="validation-result-panel" data-valid={valid}>
        {valid ? "Spec is valid." : "Spec has validation errors — see markers above."}
      </div>

      <button
        type="button"
        data-testid="save-spec-version"
        onClick={() => void save()}
        disabled={!valid || saving}
      >
        {saving ? "Saving…" : "Save version"}
      </button>
      {saved && <p data-testid="save-spec-success">Saved.</p>}
      {error && (
        <p role="alert" data-testid="save-spec-error">
          {error}
        </p>
      )}

      <StructuralPreview
        spec={valid ? (currentSpec as Parameters<typeof StructuralPreview>[0]["spec"]) : null}
      />

      <Link data-testid="launch-run-link" to={`/runs?scenario=${scenarioId}`}>
        Launch a run
      </Link>

      <VersionHistory scenarioId={scenarioId} />
    </section>
  );
}

export function ScenarioWorkspacePage() {
  return (
    <Routes>
      <Route index element={<ScenarioListView />} />
      <Route path=":scenarioId" element={<ScenarioDetailView />} />
    </Routes>
  );
}
