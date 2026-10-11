import { useEffect, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { SimulationSpec } from "@txloom/spec";
import { CheckCircle2, Rocket, XCircle } from "lucide-react";
import { apiClient } from "../../api/client.js";
import { PageHeader } from "../../components/layout/page-header.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input } from "../../components/ui/input.js";
import { cn } from "../../lib/cn.js";
import { LaunchDrawer } from "./launch-drawer.js";
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

        <TemplateGallery
          onCloned={(scenarioId, versionNumber) =>
            navigate(`/scenarios/${scenarioId}`, { state: { clonedVersion: versionNumber } })
          }
        />
      </div>
    </div>
  );
}

function ScenarioDetailView() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const clonedVersion = (useLocation().state as { clonedVersion?: number } | null)?.clonedVersion;
  const [searchParams, setSearchParams] = useSearchParams();
  const launchOpen = searchParams.get("launch") === "1";
  const [scenario, setScenario] = useState<ScenarioRow | null>(null);
  const [initialSpec, setInitialSpec] = useState<object | null>(null);
  const [currentSpec, setCurrentSpec] = useState<SimulationSpec | null>(null);
  // What a launch actually runs: the saved version, not unsaved edits in the editor.
  const [savedSpec, setSavedSpec] = useState<SimulationSpec | null>(null);
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
            setSavedSpec((current?.spec as SimulationSpec | undefined) ?? null);
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
      setSavedSpec(currentSpec);
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
          <Button
            data-testid="launch-open"
            onClick={() => setSearchParams({ launch: "1" })}
            disabled={!scenario?.current_version_id && !saved}
          >
            <Rocket className="h-4 w-4" aria-hidden="true" />
            Launch
          </Button>
        }
      />

      {clonedVersion !== undefined && (
        <p
          data-testid="version-saved-badge"
          className="bg-success/10 text-success mb-4 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />v{clonedVersion} saved — ready to
          launch
        </p>
      )}

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

      <LaunchDrawer
        open={launchOpen}
        onOpenChange={(open) => {
          if (!open) setSearchParams({});
        }}
        scenarioId={scenarioId}
        spec={savedSpec}
        onLaunched={(run) => navigate(`/runs/${run.id}/progress`)}
      />
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
