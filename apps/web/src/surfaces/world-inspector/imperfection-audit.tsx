import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

interface ImperfectionAuditRow {
  corruption_type: string;
  sink: string;
  count: number;
}

/** Imperfection audit table: corruption counts by type × sink (FR-036 §4). */
export function ImperfectionAudit({ runId }: { runId: string }) {
  const [rows, setRows] = useState<ImperfectionAuditRow[] | null>(null);

  useEffect(() => {
    apiClient
      .get<{ rows: ImperfectionAuditRow[] }>(`/runs/${runId}/inspector/imperfection-audit`)
      .then((res) => setRows(res.rows))
      .catch(() => setRows(null));
  }, [runId]);

  if (!rows) return <p>Loading imperfection audit…</p>;

  return (
    <table className="imperfection-audit">
      <thead>
        <tr>
          <th>Corruption type</th>
          <th>Sink</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.corruption_type}-${row.sink}`}>
            <td>{row.corruption_type}</td>
            <td>{row.sink}</td>
            <td>{row.count.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
