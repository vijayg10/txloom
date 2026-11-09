export interface FieldNote {
  path: string;
  note: string;
}

/** Per-field annotations beyond what raw JSON Schema conveys — the "why" and
 * "typical range" an agent needs to author a plausible spec on the first try
 * (FR-009). Kept as data so it can render into both `/spec/docs` and the
 * published `documentation/docs/technical/agent-reference.md` markdown from one source. */
export const SCHEMA_FIELD_NOTES: readonly FieldNote[] = [
  {
    path: "/seed",
    note: "Integer from 0 to 9007199254740991 (larger 64-bit seeds go in the launch `seed` string, up to 18446744073709551615). Same seed + same spec always reproduces byte-identical output — this is the product's core guarantee.",
  },
  {
    path: "/currency",
    note: "ISO 4217 3-letter code (e.g. INR, USD). Exactly one currency per scenario.",
  },
  {
    path: "/locale",
    note: "Selects the name-dictionary pack for consumer/merchant display names. Must be a shipped pack — currently en-IN, en-US.",
  },
  {
    path: "/channel",
    note: 'A free-text label stamped on every event, e.g. "upi", "card_present", "wallet" — pick something matching the scenario\'s real-world channel.',
  },
  { path: "/clock/start", note: 'ISO date the history phase begins, e.g. "2026-01-01".' },
  {
    path: "/clock/days",
    note: "Length of the history phase in days. Typical range 30–90 for a demo, up to the reference scale's 90-day benchmark.",
  },
  {
    path: "/clock/then_stream_tps",
    note: "Optional — if set, the run continues past history as a live stream at this target TPS. Omit for a batch-only run.",
  },
  {
    path: "/population/consumers/count",
    note: "Reference scale is 200,000; smaller (100s–1000s) is fine and faster for demos/tests.",
  },
  {
    path: "/population/consumers/archetypes",
    note: "Weighted list; weights across all archetypes must sum to 1 (±1e-6).",
  },
  {
    path: "/population/consumers/archetypes/*/income_pattern",
    note: 'kind: "fixed_credit_day" (salaried, needs day_of_month 1-28 — the validator does not require it, but without it the archetype is never paid) or "irregular_weekly" (gig work, no day_of_month).',
  },
  {
    path: "/population/merchants/categories",
    note: "Keyed by category name; weights across all categories must sum to 1 (±1e-6).",
  },
  {
    path: "/seasonality/*/window",
    note: "[startDate, endDate] — must intersect [clock.start, clock.start + clock.days) or the invariant battery rejects it.",
  },
  {
    path: "/fraud/target_rate",
    note: "0 to 0.5. The achieved rate converges to this within a few percentage points — see get_realism_report after a run.",
  },
  {
    path: "/fraud/typologies",
    note: "shares across the array must sum to 1 (±1e-6). Each typology's params shape depends on its type — see the worked examples.",
  },
  {
    path: "/fraud/typologies/*[type=account_takeover]/params/dormancy_days",
    note: "Must be less than clock.days, or no persona can ever satisfy the dormancy precondition.",
  },
  {
    path: "/outcomes/baseline_decline_rate",
    note: "0 to 1. Share of legitimate transactions declined for ordinary reasons, independent of fraud — typically 0.01–0.05.",
  },
  {
    path: "/imperfections/*",
    note: "Each configured imperfection needs rate in [0, 0.2]. duplicate_delivery/late_arrival/out_of_order/clock_skew accept an optional `sinks` allowlist — omit it to apply to every sink.",
  },
  {
    path: "/imperfections/clock_skew/sources",
    note: "Each source.source must name a declared output.sinks[].name.",
  },
  {
    path: "/output/sinks",
    note: "At least one sink. type: file | kafka | rabbitmq | webhook. `name` is the join key imperfections target.",
  },
  {
    path: "/output/sinks/*/format",
    note: "Optional — csv | parquet | json. Descriptive only: the file format is chosen per export (`create_export {format}`), and brokers and webhooks always carry JSON.",
  },
  {
    path: "/output/labels",
    note: 'Required — "separate_export" (recommended) or "merged_with_warning". Labels are kept out of exports either way: a `create_export` with include_labels:true is refused unless it also sends acknowledged_warning:true.',
  },
  {
    path: "/output/stream_label_channel",
    note: "Optional, default false. The default for a launch's `label_channel`: when true, the live stream also publishes each event's label to the destination's `label_topic` (Kafka only).",
  },
];

export function renderSchemaReference(): string {
  const lines = ["# SimulationSpec field reference", ""];
  for (const { path, note } of SCHEMA_FIELD_NOTES) {
    lines.push(`- \`${path}\` — ${note}`);
  }
  return lines.join("\n") + "\n";
}
