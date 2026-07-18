import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { apiClient } from "../../api/client.js";
import { AmountDistributions } from "./amount-distributions.js";
import { FraudTimeline } from "./fraud-timeline.js";
import { ImperfectionAudit } from "./imperfection-audit.js";
import { PersonaHeatmap } from "./persona-heatmap.js";
import { RealismReportView } from "./realism-report.js";
import { VolumeChart } from "./volume-chart.js";

interface RunRow {
  id: string;
  status: string;
}

function InspectorRunPicker() {
  const [runs, setRuns] = useState<RunRow[]>([]);

  useEffect(() => {
    apiClient
      .get<{ runs: RunRow[] }>("/runs")
      .then((res) => setRuns(res.runs))
      .catch(() => setRuns([]));
  }, []);

  return (
    <section>
      <h1>World inspector</h1>
      <ul data-testid="inspector-run-picker">
        {runs.map((run) => (
          <li key={run.id}>
            <Link data-testid="inspector-run-picker-item" to={`/inspector/${run.id}`}>
              {run.id} ({run.status})
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InspectorRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  if (!runId) return null;

  return (
    <section>
      <h1>
        World inspector — run <code>{runId}</code>
      </h1>
      <div data-testid="inspector-volume-chart">
        <h2>Volume over time</h2>
        <VolumeChart runId={runId} />
      </div>
      <div data-testid="inspector-amount-distributions">
        <h2>Amount distributions</h2>
        <AmountDistributions runId={runId} />
      </div>
      <div data-testid="inspector-persona-heatmap">
        <h2>Persona heatmap</h2>
        <PersonaHeatmap runId={runId} />
      </div>
      <div data-testid="inspector-fraud-timeline">
        <h2>Fraud timeline</h2>
        <FraudTimeline runId={runId} />
      </div>
      <div data-testid="inspector-imperfection-audit">
        <h2>Imperfection audit</h2>
        <ImperfectionAudit runId={runId} />
      </div>
      <div data-testid="inspector-realism-report">
        <RealismReportView runId={runId} />
      </div>
    </section>
  );
}

export function WorldInspectorPage() {
  return (
    <Routes>
      <Route index element={<InspectorRunPicker />} />
      <Route path=":runId" element={<InspectorRunDetail />} />
    </Routes>
  );
}
