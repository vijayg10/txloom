import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { TableSkeleton } from "../../components/ui/loading-skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "../../components/data/table.js";

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

  if (!rows) return <TableSkeleton columns={3} />;
  if (rows.length === 0) return <EmptyState title="No imperfections recorded" />;

  return (
    <Table>
      <TableHead>
        <TableHeaderRow>
          <TableHeaderCell>Corruption type</TableHeaderCell>
          <TableHeaderCell>Sink</TableHeaderCell>
          <TableHeaderCell>Count</TableHeaderCell>
        </TableHeaderRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.corruption_type}-${row.sink}`}>
            <TableCell>{row.corruption_type}</TableCell>
            <TableCell>{row.sink}</TableCell>
            <TableCell>{row.count.toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
