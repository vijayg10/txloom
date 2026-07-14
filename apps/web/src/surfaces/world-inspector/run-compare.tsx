import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

interface ComparisonSide {
  run: { id: string; status: string; seed: string };
  volume_over_time: { points: { date: string; count: number }[] };
  amount_distributions: { group: string; count: number; mean: number }[];
  fraud_timeline: { date: string; typology: string; count: number }[];
}

interface CompareResult {
  a: ComparisonSide;
  b: ComparisonSide;
}

function SideSummary({ side, label }: { side: ComparisonSide; label: string }) {
  const totalEvents = side.volume_over_time.points.reduce((sum, p) => sum + p.count, 0);
  const totalFraud = side.fraud_timeline.reduce((sum, p) => sum + p.count, 0);
  return (
    <div className="run-compare-side">
      <h3>
        {label}: <code>{side.run.id}</code>
      </h3>
      <p>status: {side.run.status}</p>
      <p>seed: {side.run.seed}</p>
      <p>total events: {totalEvents.toLocaleString()}</p>
      <p>fraud events: {totalFraud.toLocaleString()}</p>
      <ul>
        {side.amount_distributions.map((bucket) => (
          <li key={bucket.group}>
            {bucket.group}: mean {bucket.mean.toFixed(2)} ({bucket.count} events)
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Side-by-side run comparison view (FR-036 §4). */
export function RunCompare({ runIdA, runIdB }: { runIdA: string; runIdB: string }) {
  const [result, setResult] = useState<CompareResult | null>(null);

  useEffect(() => {
    apiClient
      .get<CompareResult>(`/runs/compare?a=${runIdA}&b=${runIdB}`)
      .then(setResult)
      .catch(() => setResult(null));
  }, [runIdA, runIdB]);

  if (!result) return <p>Loading comparison…</p>;

  return (
    <div className="run-compare">
      <SideSummary side={result.a} label="Run A" />
      <SideSummary side={result.b} label="Run B" />
    </div>
  );
}
