import { useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import type { SimulationSpec } from "@txloom/spec";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { apiClient } from "../../api/client.js";
import { PageHeader } from "../../components/layout/page-header.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input } from "../../components/ui/input.js";
import { cn } from "../../lib/cn.js";
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
    <div>
      <PageHeader title="Scenario workspace" />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Scenarios</CardTitle>
          </CardHeader>
          <CardBody>
            {scenarios && scenarios.length === 0 ? (
              <p className="text-text-secondary text-sm">No scenarios yet — create one below.</p>
            ) : (
              <ul className="divide-border flex flex-col divide-y" data-testid="scenario-list">
                {(scenarios ?? []).map((scenario) => (
                  <li key={scenario.id} className="py-2.5">
                    <Link
                      data-testid="scenario-list-item"
                      to={`/scenarios/${scenario.id}`}
                      className="text-primary font-medium hover:underline"
                    >
                      {scenario.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New blank scenario</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              data-testid="new-scenario-form"
              onSubmit={(e) => void createBlank(e)}
              className="flex flex-col gap-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Name">
                  <Input
                    data-testid="new-scenario-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </FormField>
                <FormField label="Currency">
                  <Input
                    data-testid="new-scenario-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    required
                  />
                </FormField>
              </div>
              <div>
                <Button type="submit" data-testid="create-blank-scenario">
                  Create
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <TemplateGallery onCloned={(scenarioId) => navigate(`/scenarios/${scenarioId}`)} />
      </div>
    </div>
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
    <div>
      <PageHeader
        title={scenario?.name ?? "Scenario"}
        actions={
          <Link
            data-testid="launch-run-link"
            to={`/runs?scenario=${scenarioId}`}
            className="bg-primary hover:bg-primary-hover inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium text-white shadow-sm transition-all duration-200"
          >
            Launch a run
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardBody>
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

            <div
              data-testid="validation-result-panel"
              data-valid={valid}
              className={cn(
                "mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm",
                valid ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
              )}
            >
              {valid ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {valid ? "Spec is valid." : "Spec has validation errors — see markers above."}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button
                data-testid="save-spec-version"
                onClick={() => void save()}
                disabled={!valid || saving}
                loading={saving}
              >
                {saving ? "Saving…" : "Save version"}
              </Button>
              {saved && (
                <p data-testid="save-spec-success" className="text-success text-sm">
                  Saved.
                </p>
              )}
              {error && (
                <p role="alert" data-testid="save-spec-error" className="text-danger text-sm">
                  {error}
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        <StructuralPreview
          spec={valid ? (currentSpec as Parameters<typeof StructuralPreview>[0]["spec"]) : null}
        />

        <VersionHistory scenarioId={scenarioId} />
      </div>
    </div>
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
