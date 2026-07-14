// SimulationSpec — the authoritative, versioned document every run is generated
// from (data-model.md § Spec document). Top-level keys per FR-002.

export type SinkType = "file" | "kafka" | "rabbitmq" | "webhook";

export interface ClockConfig {
  /** ISO 8601 date the history phase begins, e.g. "2026-01-01". */
  start: string;
  /** Length of the history phase in days. */
  days: number;
  /** If present, the history phase continues as a live stream at this target TPS (FR-029). */
  then_stream_tps?: number;
}

export interface IncomePattern {
  kind: "fixed_credit_day" | "irregular_weekly";
  /** Day of month income lands, for kind: "fixed_credit_day". */
  day_of_month?: number;
  amount_mean: number;
  amount_stddev: number;
}

export interface SpendRhythm {
  daily_transaction_count_mean: number;
  daily_transaction_count_stddev: number;
  weekend_multiplier: number;
}

export interface ConsumerArchetype {
  name: string;
  /** Relative weight within population.consumers.archetypes; all weights sum to 1±ε. */
  weight: number;
  income_pattern: IncomePattern;
  spend_rhythm: SpendRhythm;
}

export interface AmountDistribution {
  kind: "lognormal" | "normal" | "exponential";
  mean: number;
  stddev?: number;
}

export interface MerchantCategory {
  name: string;
  /** Relative weight within population.merchants.categories; all weights sum to 1±ε. */
  weight: number;
  amount_distribution: AmountDistribution;
}

export interface PopulationConfig {
  consumers: {
    count: number;
    archetypes: ConsumerArchetype[];
  };
  merchants: {
    count: number;
    categories: Record<string, MerchantCategory>;
  };
}

export interface SeasonalityWindow {
  event: string;
  /** [startISODate, endISODate] — must intersect the clock window. */
  window: [string, string];
  volume_multiplier: number;
}

export interface CardTestingParams {
  burst_size_min: number;
  burst_size_max: number;
  burst_window_minutes: number;
  amount_min: number;
  amount_max: number;
}

export interface AccountTakeoverParams {
  /** Days an account must sit dormant before takeover — must fit within clock.days. */
  dormancy_days: number;
  drain_step_count: number;
}

export interface RefundAbuseParams {
  refund_rate: number;
  max_refunds_per_actor: number;
}

export type FraudTypologyConfig =
  | { type: "card_testing"; share: number; params: CardTestingParams }
  | { type: "account_takeover"; share: number; params: AccountTakeoverParams }
  | { type: "refund_abuse"; share: number; params: RefundAbuseParams };

export interface FraudConfig {
  /** Overall achieved fraud rate target, 0..0.5. */
  target_rate: number;
  /** typologies[].share sums to 1±ε across the array. */
  typologies: FraudTypologyConfig[];
}

export interface OutcomesConfig {
  baseline_decline_rate: number;
}

export interface ImperfectionRateConfig {
  /** 0..0.2 */
  rate: number;
  /** Sink names this imperfection targets; must be a subset of output.sinks[].name. */
  sinks?: string[];
}

export interface LateArrivalConfig extends ImperfectionRateConfig {
  delay_seconds_mean: number;
  delay_seconds_stddev: number;
}

export interface ClockSkewSource {
  /** Must match an output.sinks[].name (declared source). */
  source: string;
  offset_seconds: number;
}

export interface ClockSkewConfig extends ImperfectionRateConfig {
  sources: ClockSkewSource[];
}

export interface ImperfectionsConfig {
  duplicate_delivery?: ImperfectionRateConfig;
  late_arrival?: LateArrivalConfig;
  out_of_order?: ImperfectionRateConfig;
  clock_skew?: ClockSkewConfig;
}

export interface OutputSinkRef {
  type: SinkType;
  /** Unique name within output.sinks — the join key for imperfection targeting. */
  name: string;
  format?: "csv" | "parquet" | "json";
}

export interface OutputConfig {
  sinks: OutputSinkRef[];
  labels: "separate_export" | "merged_with_warning";
  stream_label_channel?: boolean;
}

export interface SimulationSpec {
  seed: number;
  /** ISO 4217 currency code — single currency per scenario. */
  currency: string;
  /** Selects the name-dictionary pack for party display names (FR-014a, D18). */
  locale: string;
  /** Delivery channel label stamped on every event, e.g. "upi", "card_present", "wallet". */
  channel: string;
  clock: ClockConfig;
  population: PopulationConfig;
  seasonality: SeasonalityWindow[];
  fraud: FraudConfig;
  outcomes: OutcomesConfig;
  imperfections: ImperfectionsConfig;
  output: OutputConfig;
}

/** A located, machine-actionable spec violation (FR-003/004) — the one error
 * model shared by the editor, the API, and the MCP validate_spec tool. */
export interface InvariantViolation {
  /** JSON Pointer (RFC 6901) into the spec document, e.g. "/fraud/target_rate". */
  path: string;
  /** Machine-readable code, e.g. "fraud-rate-out-of-bounds". */
  code: string;
  /** Human-readable explanation + remedy. */
  message: string;
  /** "warning" violations (e.g. above reference scale) don't flip `valid` to false. Defaults to "error". */
  severity?: "error" | "warning";
}

export type InvariantFn = (spec: SimulationSpec) => InvariantViolation[];

export interface ValidationResult {
  valid: boolean;
  violations: InvariantViolation[];
}
