export interface InvariantCatalogEntry {
  code: string;
  invariant: string;
  remedy: string;
}

/** Error-code-to-remedy catalog for every semantic invariant in
 * packages/spec/src/invariants — the same codes validate_spec's `violations[]`
 * returns, so an agent's repair loop can look up "what do I change" directly
 * (FR-009/010). Kept as data, one source rendered into both `/spec/docs` and
 * the published `docs/agent/` markdown. */
export const INVARIANT_CATALOG: readonly InvariantCatalogEntry[] = [
  {
    code: "seasonality-window-outside-clock",
    invariant: "Every seasonality window must intersect [clock.start, clock.start + clock.days).",
    remedy:
      "Move the window's [start, end] dates inside the clock range, or extend clock.days to cover it.",
  },
  {
    code: "archetype-weights-not-normalized",
    invariant: "population.consumers.archetypes[].weight must sum to 1 (±1e-6).",
    remedy: "Rescale each archetype's weight so the array sums to exactly 1.",
  },
  {
    code: "merchant-category-weights-not-normalized",
    invariant: "population.merchants.categories[].weight must sum to 1 (±1e-6).",
    remedy: "Rescale each category's weight so all categories sum to exactly 1.",
  },
  {
    code: "fraud-typology-shares-not-normalized",
    invariant: "fraud.typologies[].share must sum to 1 (±1e-6).",
    remedy: "Rescale each typology's share so the array sums to exactly 1.",
  },
  {
    code: "fraud-rate-out-of-bounds",
    invariant: "fraud.target_rate must be between 0 and 0.5 inclusive.",
    remedy: "Lower (or raise) target_rate into [0, 0.5].",
  },
  {
    code: "dormancy-not-satisfiable",
    invariant: "An account_takeover typology's dormancy_days must be less than clock.days.",
    remedy:
      "Reduce fraud.typologies[].params.dormancy_days below clock.days, or increase clock.days.",
  },
  {
    code: "imperfection-rate-out-of-bounds",
    invariant: "Every configured imperfection's rate must be between 0 and 0.2 inclusive.",
    remedy: "Lower the offending imperfections.<type>.rate into [0, 0.2].",
  },
  {
    code: "imperfection-sink-not-declared",
    invariant:
      "imperfections.<type>.sinks entries must name a sink declared in output.sinks[].name.",
    remedy:
      "Either add the missing sink to output.sinks, or remove/rename the entry in the imperfection's sinks list.",
  },
  {
    code: "locale-pack-not-found",
    invariant: "spec.locale must reference a shipped name-dictionary pack.",
    remedy:
      "Use a shipped locale (currently en-IN or en-US), or contribute a new pack under packages/engine/data/name-packs/.",
  },
  {
    code: "clock-skew-source-not-declared",
    invariant:
      "imperfections.clock_skew.sources[].source must name a sink declared in output.sinks[].name.",
    remedy:
      "Either add the missing sink to output.sinks, or fix the source name to match an existing sink.",
  },
  {
    code: "population-above-reference-scale",
    invariant:
      "population counts above the documented reference scale (200k consumers / 5k merchants) are a warning, not a rejection.",
    remedy:
      "No action required — generation still works; this is outside the benchmarked envelope, so expect longer run times.",
  },
  {
    code: "stream-tps-above-benchmark",
    invariant:
      "clock.then_stream_tps above the benchmarked maximum (1,000 TPS sustained to Kafka) is a warning, not a rejection.",
    remedy:
      "No action required — sustained delivery above this rate is simply unverified by the published benchmark.",
  },
];

export function renderInvariantCatalog(): string {
  const lines = ["# Semantic invariant catalog", ""];
  for (const { code, invariant, remedy } of INVARIANT_CATALOG) {
    lines.push(`## \`${code}\``, "", invariant, "", `**Remedy:** ${remedy}`, "");
  }
  return lines.join("\n");
}
