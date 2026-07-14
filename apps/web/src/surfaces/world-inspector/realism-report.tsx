import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

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

  if (loading) return <p>Loading realism report…</p>;
  if (!report) return <p>Realism report not available yet — check back once the run completes.</p>;

  return (
    <div className="realism-report">
      <h2>Realism report</h2>
      <p>{report.event_count.toLocaleString()} events</p>

      <section>
        <h3>Amount distribution</h3>
        <p>
          mean {report.amount.mean.toFixed(2)} · stddev {report.amount.stddev.toFixed(2)} · range [
          {report.amount.min.toFixed(2)}, {report.amount.max.toFixed(2)}]
        </p>
      </section>

      <section>
        <h3>Inter-arrival time</h3>
        <p>
          mean {report.inter_arrival_ms.mean.toFixed(0)}ms · stddev{" "}
          {report.inter_arrival_ms.stddev.toFixed(0)}ms
        </p>
      </section>

      <section>
        <h3>Fraud — achieved vs. target</h3>
        <p>
          achieved {(report.fraud.achieved_rate * 100).toFixed(2)}%
          {targetFraudRate !== undefined ? ` (target ${(targetFraudRate * 100).toFixed(2)}%)` : ""}
        </p>
        <ul>
          {Object.entries(report.fraud.by_typology).map(([typology, count]) => (
            <li key={typology}>
              {typology}: {count.toLocaleString()}
            </li>
          ))}
        </ul>
      </section>

      {report.benchmark_comparison && (
        <section>
          <h3>Benchmark comparison</h3>
          <pre>{JSON.stringify(report.benchmark_comparison, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
