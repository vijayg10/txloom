import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { StatusBadge, runStatusTone } from "../../components/ui/status-badge.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "../../components/data/table.js";
import { TableSkeleton } from "../../components/ui/loading-skeleton.js";
import type { RunStatus } from "./run-status.js";

interface RunRow {
  id: string;
  status: RunStatus;
  created_at: string;
}

/** Run list: status, links into run detail (FR-032). Live progress bars/
 * throughput/ETA render inside RunDetail via the WS channel once a run is open. */
export function RunList() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);

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

  if (runs === null) return <TableSkeleton columns={3} />;

  if (runs.length === 0) {
    return (
      <EmptyState title="No runs yet" description="Launch a run from a scenario to see it here." />
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderRow>
          <TableHeaderCell>Run</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Created</TableHeaderCell>
        </TableHeaderRow>
      </TableHead>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>
              <a href={`/runs/${run.id}`} className="text-primary font-medium hover:underline">
                {run.id}
              </a>
            </TableCell>
            <TableCell>
              <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
            </TableCell>
            <TableCell className="text-text-secondary">
              {new Date(run.created_at).toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
