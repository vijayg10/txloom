import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createApiClient, type Run } from "../../api/client.js";
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
import { formatRunTitle } from "../run/index.js";

/** Run list (FR-050): each run is named by its scenario, version and start time, with the ID
 * secondary. `?filter=streamable` keeps only runs whose history is complete. */
export function RunList() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [searchParams] = useSearchParams();
  const streamableOnly = searchParams.get("filter") === "streamable";

  useEffect(() => {
    let cancelled = false;
    createApiClient()
      .listRuns()
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

  const shown = streamableOnly ? runs.filter((run) => run.status === "completed") : runs;
  if (shown.length === 0) {
    return (
      <EmptyState
        title={streamableOnly ? "No completed runs" : "No runs yet"}
        description={
          streamableOnly
            ? "Complete a run to start streaming its events."
            : "Launch a run from a scenario to see it here."
        }
      />
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
        {shown.map((run) => (
          <TableRow key={run.id}>
            <TableCell>
              <Link
                to={`/runs/${run.id}/progress`}
                data-testid="run-list-item"
                className="text-primary font-medium hover:underline"
              >
                {formatRunTitle(run)}
              </Link>
              <p className="text-text-secondary font-mono text-xs">{run.id}</p>
            </TableCell>
            <TableCell>
              <StatusBadge tone={runStatusTone(run.status)}>{run.phase ?? run.status}</StatusBadge>
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
