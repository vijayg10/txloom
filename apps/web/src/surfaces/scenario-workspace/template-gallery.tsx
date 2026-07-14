import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

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

  if (!templates) return <p>Loading templates…</p>;

  return (
    <section className="template-gallery">
      <h2>Template gallery</h2>
      <ul>
        {templates.map((template) => (
          <li key={template.slug}>
            <h3>{template.name}</h3>
            <p>{template.description}</p>
            <button
              type="button"
              onClick={() => void clone(template)}
              disabled={cloning === template.slug}
            >
              {cloning === template.slug ? "Cloning…" : "New from template"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="template-gallery-error">{error}</p>}
    </section>
  );
}
