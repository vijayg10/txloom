import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody } from "../../components/ui/card.js";

interface Template {
  slug: string;
  name: string;
  description: string;
  benchmark_refs: Record<string, unknown>;
}

interface ScenarioRow {
  id: string;
  name: string;
}

/** Template gallery (FR-006): browse the four seeded starter scenarios and
 * clone one into a new, immediately-editable scenario. */
export function TemplateGallery({ onCloned }: { onCloned?: (scenarioId: string) => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ templates: Template[] }>("/templates")
      .then((body) => setTemplates(body.templates))
      .catch(() => setTemplates([]));
  }, []);

  async function clone(template: Template) {
    setCloning(template.slug);
    setError(null);
    try {
      const scenario = await apiClient.post<ScenarioRow>("/scenarios", {
        name: `${template.name} (from template)`,
        template_slug: template.slug,
      });
      onCloned?.(scenario.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to clone template");
    } finally {
      setCloning(null);
    }
  }

  if (!templates) return <p className="text-text-secondary text-sm">Loading templates…</p>;

  return (
    <section>
      <h3 className="text-text mb-3 text-sm font-semibold">Template gallery</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Card key={template.slug} className="flex flex-col">
            <CardBody className="flex flex-1 flex-col">
              <h4 className="text-text font-semibold">{template.name}</h4>
              <p className="text-text-secondary mt-1 flex-1">{template.description}</p>
              <div className="mt-4">
                <Button
                  variant="secondary"
                  onClick={() => void clone(template)}
                  loading={cloning === template.slug}
                >
                  {cloning === template.slug ? "Cloning…" : "New from template"}
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
