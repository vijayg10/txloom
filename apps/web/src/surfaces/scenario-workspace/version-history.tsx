import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";

interface SpecVersionRow {
  id: string;
  version_no: number;
  spec: unknown;
  author_type: "user" | "agent" | "rollback";
  parent_version_id: string | null;
  created_at: string;
}

interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

/** Version-history per-version comparison — every mutation (hand-edited or
 * agent-saved via MCP) lands as a new, reviewable, rollbackable entry, never
 * silent regeneration (constitution Principle IV, FR-005). */
export function VersionHistory({ scenarioId }: { scenarioId: string }) {
  const [versions, setVersions] = useState<SpecVersionRow[]>([]);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffEntry[] | null>(null);

  useEffect(() => {
    apiClient
      .get<{ versions: SpecVersionRow[] }>(`/scenarios/${scenarioId}/versions`)
      .then((res) => setVersions(res.versions))
      .catch(() => setVersions([]));
  }, [scenarioId]);

  async function compareToPrevious(version: SpecVersionRow) {
    const previous = versions.find((v) => v.id === version.parent_version_id);
    if (!previous) {
      setDiff([]);
      setCompareWith(version.id);
      return;
    }
    const { diffSpecs } = await import("@txloom/spec");
    setDiff(diffSpecs(previous.spec, version.spec));
    setCompareWith(version.id);
  }

  async function rollback(version: SpecVersionRow) {
    await apiClient.post(`/scenarios/${scenarioId}/versions/${version.id}/rollback`);
    const res = await apiClient.get<{ versions: SpecVersionRow[] }>(
      `/scenarios/${scenarioId}/versions`,
    );
    setVersions(res.versions);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Version history</CardTitle>
      </CardHeader>
      <CardBody>
        <ul className="divide-border flex flex-col divide-y">
          {versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="text-text-secondary flex-1">
                v{version.version_no} · {version.author_type} ·{" "}
                {new Date(version.created_at).toLocaleString()}
              </span>
              <Button variant="secondary" onClick={() => void compareToPrevious(version)}>
                Compare to previous
              </Button>
              <Button variant="secondary" onClick={() => void rollback(version)}>
                Rollback to this
              </Button>
            </li>
          ))}
        </ul>
        {compareWith && diff && (
          <div className="border-border mt-4 rounded-xl border p-4">
            <h4 className="text-text mb-2 text-sm font-semibold">
              Diff for v{versions.find((v) => v.id === compareWith)?.version_no}
            </h4>
            {diff.length === 0 ? (
              <p className="text-text-secondary text-sm">No prior version to compare against.</p>
            ) : (
              <ul className="text-text-secondary flex flex-col gap-1 text-sm">
                {diff.map((entry) => (
                  <li key={entry.path}>
                    <code className="text-text font-mono">{entry.path}</code> — {entry.kind}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
