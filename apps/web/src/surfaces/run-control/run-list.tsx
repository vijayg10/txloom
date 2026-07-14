import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

interface RunRow {
  id: string;
  status: string;
  created_at: string;
}

/** Run list: status, links into run detail (FR-032). Live progress bars/
 * throughput/ETA render inside RunDetail via the WS channel once a run is open. */
export function RunList() {
  const [runs, setRuns] = useState<RunRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ runs: RunRow[] }>("/runs")
      .then((res) => {
        if (!cancelled) setRuns(res.runs);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <table className="run-list">
      <thead>
        <tr>
          <th>Run</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td>
              <a href={`/runs/${run.id}`}>{run.id}</a>
            </td>
            <td>{run.status}</td>
            <td>{new Date(run.created_at).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
