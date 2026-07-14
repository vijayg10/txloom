import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

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
    <div className="version-history">
      <ul>
        {versions.map((version) => (
          <li key={version.id}>
            v{version.version_no} · {version.author_type} ·{" "}
            {new Date(version.created_at).toLocaleString()}{" "}
            <button type="button" onClick={() => void compareToPrevious(version)}>
              Compare to previous
            </button>{" "}
            <button type="button" onClick={() => void rollback(version)}>
              Rollback to this
            </button>
          </li>
        ))}
      </ul>
      {compareWith && diff && (
        <div className="version-diff">
          <h3>Diff for v{versions.find((v) => v.id === compareWith)?.version_no}</h3>
          {diff.length === 0 ? (
            <p>No prior version to compare against.</p>
          ) : (
            <ul>
              {diff.map((entry) => (
                <li key={entry.path}>
                  <code>{entry.path}</code> — {entry.kind}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
