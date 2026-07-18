import { Card, CardBody, CardTitle } from "../../components/ui/card.js";

interface PreviewSpec {
  clock: { days: number };
  population: {
    consumers: { count: number; archetypes: { name: string; weight: number }[] };
    merchants: { count: number };
  };
  fraud: { target_rate: number; typologies: { type: string; share: number }[] };
  imperfections: Record<string, { rate: number } | undefined>;
}

function estimateDailyVolume(spec: PreviewSpec): number {
  // Rough estimate for the preview panel only — the engine's real generation
  // pipeline is the source of truth for actual counts.
  return Math.round(spec.population.consumers.count * 2.2);
}

/** Live structural summary of the spec being edited — population, typology
 * mix, imperfection profile, estimated volume (FR-036 §1). Recomputed from
 * whatever the spec editor currently holds, valid or not, so authors get
 * immediate feedback while typing. */
export function StructuralPreview({ spec }: { spec: PreviewSpec | null }) {
  if (!spec) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-secondary text-sm">Edit the spec to see a live preview.</p>
        </CardBody>
      </Card>
    );
  }

  const dailyVolume = estimateDailyVolume(spec);
  const totalDays = spec.clock.days;
  const imperfections = Object.entries(spec.imperfections).filter(([, v]) => v);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardTitle>Population</CardTitle>
        <CardBody className="mt-3">
          <p className="text-text text-lg font-semibold tabular-nums">
            {spec.population.consumers.count.toLocaleString()} consumers ·{" "}
            {spec.population.merchants.count.toLocaleString()} merchants
          </p>
          <ul className="text-text-secondary mt-3 flex flex-col gap-1">
            {spec.population.consumers.archetypes.map((a) => (
              <li key={a.name} className="flex justify-between">
                <span>{a.name}</span>
                <span className="tabular-nums">{Math.round(a.weight * 100)}%</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Fraud</CardTitle>
        <CardBody className="mt-3">
          <p className="text-text text-lg font-semibold tabular-nums">
            Target rate: {Math.round(spec.fraud.target_rate * 1000) / 10}%
          </p>
          <ul className="text-text-secondary mt-3 flex flex-col gap-1">
            {spec.fraud.typologies.map((t) => (
              <li key={t.type} className="flex justify-between">
                <span>{t.type}</span>
                <span className="tabular-nums">{Math.round(t.share * 100)}% share</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Imperfections</CardTitle>
        <CardBody className="mt-3">
          <ul className="text-text-secondary flex flex-col gap-1">
            {imperfections.map(([key, v]) => (
              <li key={key} className="flex justify-between">
                <span>{key}</span>
                <span className="tabular-nums">{Math.round((v?.rate ?? 0) * 100)}%</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Estimated volume</CardTitle>
        <CardBody className="mt-3">
          <p className="text-text text-lg font-semibold tabular-nums">
            ~{dailyVolume.toLocaleString()} events/day × {totalDays} days ≈{" "}
            {(dailyVolume * totalDays).toLocaleString()} events
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
