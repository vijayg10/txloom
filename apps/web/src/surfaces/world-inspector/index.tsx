import type { Run } from "../../api/client.js";
import { ChartCard } from "../../components/data/chart-card.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { AmountDistributions } from "./amount-distributions.js";
import { FraudTimeline } from "./fraud-timeline.js";
import { ImperfectionAudit } from "./imperfection-audit.js";
import { PersonaHeatmap } from "./persona-heatmap.js";
import { RealismReportView } from "./realism-report.js";
import { VolumeChart } from "./volume-chart.js";

/** The Inspect tab of a run: its generated world, scoped to this run. `runStatus` is
 * undefined until the run shell's own poll resolves, so the partial-data note only
 * appears once we actually know the run hasn't completed yet (no flash on first paint). */
export function InspectTab({
  runId,
  runStatus,
}: {
  runId: string;
  runStatus: Run["status"] | undefined;
}) {
  const isPartial = runStatus !== undefined && runStatus !== "completed";
  return (
    <div>
      {isPartial && (
        <p
          data-testid="inspector-partial-data-note"
          className="text-text-secondary mb-4 text-xs"
        >
          This run hasn't completed — charts below reflect events generated so far and will
          update as the run continues.
        </p>
      )}
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
