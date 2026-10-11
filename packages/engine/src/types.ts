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
  /** Set only on labels the delivery pump writes for events it could not deliver (FR-023);
   * `corruption_type` is null on those rows. */
  delivery_outcome: "dropped" | null;
}

/** What a sink receives for one event (contracts/wire-format.md): the truth payload plus
 * `delivery_id`, `delivered_at` and `sent_at`. `ts` is the source's event time (truth plus any
 * clock-skew offset); `delivered_at` is the simulated arrival time. */
export interface WirePayload extends TruthEvent {
  delivery_id: string;
  delivered_at: string;
  /** Wall-clock publish time; null in files and history replay. */
  sent_at: string | null;
}

/** One physical delivery of an event to one sink, with its answer-key rows. */
export interface Delivered {
  delivery_id: string;
  event_id: string;
  sink: string;
  payload: WirePayload;
  /** The event's fraud label (aligned 1:1 with the delivered row). */
  fraudLabel: LabelRecord;
  /** Imperfections applied to this delivery, in the order they were applied. */
  corruptions: LabelRecord[];
}
