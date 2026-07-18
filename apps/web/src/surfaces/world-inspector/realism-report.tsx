import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";

interface RealismReport {
  event_count: number;
  amount: { mean: number; stddev: number; min: number; max: number };
  inter_arrival_ms: { mean: number; stddev: number };
  fraud: { achieved_rate: number; by_typology: Record<string, number> };
  benchmark_comparison: Record<string, unknown> | null;
}

/** Realism-report rendering: distribution summaries, inter-arrival stats,
 * achieved-vs-target fraud rate, benchmark comparisons with sources (D17,
 * FR-034). Report absence (run still generating) renders a friendly wait state. */
export function RealismReportView({
  runId,
  targetFraudRate,
}: {
  runId: string;
  targetFraudRate?: number;
}) {
  const [report, setReport] = useState<RealismReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<RealismReport>(`/runs/${runId}/report`)
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-secondary text-sm">Loading realism report…</p>
        </CardBody>
      </Card>
    );
  }
  if (!report) {
    return (
      <Card>
        <CardBody>
          <p data-testid="realism-report-unavailable" className="text-text-secondary text-sm">
            Realism report not available yet — check back once the run completes.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card data-testid="realism-report">
      <CardHeader>
        <CardTitle>Realism report</CardTitle>
        <p
          data-testid="realism-report-event-count"
          className="text-text text-lg font-semibold tabular-nums"
        >
          {report.event_count.toLocaleString()} events
        </p>
      </CardHeader>
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="text-text-secondary text-xs font-medium">Amount distribution</h4>
            <p className="text-text mt-1 text-sm tabular-nums">
              mean {report.amount.mean.toFixed(2)} · stddev {report.amount.stddev.toFixed(2)} ·
              range [{report.amount.min.toFixed(2)}, {report.amount.max.toFixed(2)}]
            </p>
          </div>

          <div>
            <h4 className="text-text-secondary text-xs font-medium">Inter-arrival time</h4>
            <p className="text-text mt-1 text-sm tabular-nums">
              mean {report.inter_arrival_ms.mean.toFixed(0)}ms · stddev{" "}
              {report.inter_arrival_ms.stddev.toFixed(0)}ms
            </p>
          </div>

          <div className="sm:col-span-2">
            <h4 className="text-text-secondary text-xs font-medium">Fraud — achieved vs. target</h4>
            <p className="text-text mt-1 text-sm tabular-nums">
              achieved {(report.fraud.achieved_rate * 100).toFixed(2)}%
              {targetFraudRate !== undefined
                ? ` (target ${(targetFraudRate * 100).toFixed(2)}%)`
                : ""}
            </p>
            <ul className="text-text-secondary mt-2 flex flex-col gap-1 text-sm">
              {Object.entries(report.fraud.by_typology).map(([typology, count]) => (
                <li key={typology} className="flex justify-between">
                  <span>{typology}</span>
                  <span className="tabular-nums">{count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {report.benchmark_comparison && (
          <div className="mt-4">
            <h4 className="text-text-secondary mb-1 text-xs font-medium">Benchmark comparison</h4>
            <pre className="bg-hover text-text overflow-x-auto rounded-xl p-3 text-xs">
              {JSON.stringify(report.benchmark_comparison, null, 2)}
            </pre>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
