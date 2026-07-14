// Event shapes per data-model.md § Event shapes — the engine's output contract,
// independent of any delivery format (CSV/Parquet/JSON/Kafka/...).

export type EventType = "payment" | "p2p_transfer" | "income_credit" | "refund";
export type EventStatus = "approved" | "declined" | "reversed";
export type FraudTypology = "card_testing" | "account_takeover" | "refund_abuse";
export type CorruptionType = "duplicate" | "late" | "out_of_order" | "clock_skew";

export interface TruthEvent {
  event_id: string;
  ts: string;
  type: EventType;
  status: EventStatus;
  amount: number;
  currency: string;
  consumer_id: string;
  consumer_name: string;
  merchant_id: string | null;
  merchant_name: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  channel: string;
  partition_no: number;
}

export interface LabelRecord {
  event_id: string;
  is_fraud: boolean;
  typology: FraudTypology | null;
  actor_id: string | null;
  campaign_step: number | null;
  corruption_type: CorruptionType | null;
  corruption_detail: Record<string, unknown> | null;
  sink: string | null;
}

export interface DeliveredEvent {
  delivery_id: string;
  event_id: string;
  ts: string;
  sink: string;
  payload: Omit<TruthEvent, "partition_no">;
}

export interface PartitionOutput {
  truthEvents: TruthEvent[];
  labelRecords: LabelRecord[];
  deliveredEvents: DeliveredEvent[];
}
