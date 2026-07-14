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
  if (!spec) return <p>Edit the spec to see a live preview.</p>;

  const dailyVolume = estimateDailyVolume(spec);
  const totalDays = spec.clock.days;

  return (
    <div className="structural-preview">
      <section>
        <h2>Population</h2>
        <p>
          {spec.population.consumers.count.toLocaleString()} consumers ·{" "}
          {spec.population.merchants.count.toLocaleString()} merchants
        </p>
        <ul>
          {spec.population.consumers.archetypes.map((a) => (
            <li key={a.name}>
              {a.name}: {Math.round(a.weight * 100)}%
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Fraud</h2>
        <p>Target rate: {Math.round(spec.fraud.target_rate * 1000) / 10}%</p>
        <ul>
          {spec.fraud.typologies.map((t) => (
            <li key={t.type}>
              {t.type}: {Math.round(t.share * 100)}% share
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Imperfections</h2>
        <ul>
          {Object.entries(spec.imperfections)
            .filter(([, v]) => v)
            .map(([key, v]) => (
              <li key={key}>
                {key}: {Math.round((v?.rate ?? 0) * 100)}%
              </li>
            ))}
        </ul>
      </section>

      <section>
        <h2>Estimated volume</h2>
        <p>
          ~{dailyVolume.toLocaleString()} events/day × {totalDays} days ≈{" "}
          {(dailyVolume * totalDays).toLocaleString()} events
        </p>
      </section>
    </div>
  );
}
