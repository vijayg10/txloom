import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { apiClient } from "../../api/client.js";
import { PageHeader } from "../../components/layout/page-header.js";
import { ChartCard } from "../../components/data/chart-card.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { StatusBadge, runStatusTone } from "../../components/ui/status-badge.js";
import type { RunStatus } from "../run-control/run-status.js";
import { AmountDistributions } from "./amount-distributions.js";
import { FraudTimeline } from "./fraud-timeline.js";
import { ImperfectionAudit } from "./imperfection-audit.js";
import { PersonaHeatmap } from "./persona-heatmap.js";
import { RealismReportView } from "./realism-report.js";
import { VolumeChart } from "./volume-chart.js";

interface RunRow {
  id: string;
  status: RunStatus;
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
    <div>
      <PageHeader title="World inspector" />
      {runs.length === 0 ? (
        <EmptyState
          title="No runs available"
          description="Launch a run to inspect its generated world."
        />
      ) : (
        <Card>
          <CardBody>
            <ul className="divide-border flex flex-col divide-y" data-testid="inspector-run-picker">
              {runs.map((run) => (
                <li key={run.id} className="py-2.5">
                  <Link
                    data-testid="inspector-run-picker-item"
                    to={`/inspector/${run.id}`}
                    className="flex items-center gap-3"
                  >
                    <span className="text-primary font-medium hover:underline">{run.id}</span>
                    <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function InspectorRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  if (!runId) return null;

  return (
    <div>
      <PageHeader title="World inspector" meta={`Run ${runId}`} />
      <div className="flex flex-col gap-6">
        <div data-testid="inspector-volume-chart">
          <ChartCard title="Volume over time">
            <VolumeChart runId={runId} />
          </ChartCard>
        </div>
        <div data-testid="inspector-amount-distributions">
          <ChartCard title="Amount distributions">
            <AmountDistributions runId={runId} />
          </ChartCard>
        </div>
        <div data-testid="inspector-persona-heatmap">
          <Card>
            <CardHeader>
              <CardTitle>Persona heatmap</CardTitle>
            </CardHeader>
            <CardBody>
              <PersonaHeatmap runId={runId} />
            </CardBody>
          </Card>
        </div>
        <div data-testid="inspector-fraud-timeline">
          <ChartCard title="Fraud timeline">
            <FraudTimeline runId={runId} />
          </ChartCard>
        </div>
        <div data-testid="inspector-imperfection-audit">
          <Card>
            <CardHeader>
              <CardTitle>Imperfection audit</CardTitle>
            </CardHeader>
            <CardBody>
              <ImperfectionAudit runId={runId} />
            </CardBody>
          </Card>
        </div>
        <div data-testid="inspector-realism-report">
          <RealismReportView runId={runId} />
        </div>
      </div>
    </div>
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
