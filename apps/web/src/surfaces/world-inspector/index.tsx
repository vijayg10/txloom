import { ChartCard } from "../../components/data/chart-card.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { AmountDistributions } from "./amount-distributions.js";
import { FraudTimeline } from "./fraud-timeline.js";
import { ImperfectionAudit } from "./imperfection-audit.js";
import { PersonaHeatmap } from "./persona-heatmap.js";
import { RealismReportView } from "./realism-report.js";
import { VolumeChart } from "./volume-chart.js";

/** The Inspect tab of a run: its generated world, scoped to this run. */
export function InspectTab({ runId }: { runId: string }) {
  return (
    <div>
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
