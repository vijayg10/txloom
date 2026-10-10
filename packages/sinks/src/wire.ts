// The wire encoding of one delivered event (contracts/wire-format.md): UTF-8 JSON on brokers
// and webhooks. Field order is fixed so the same delivery always encodes to the same bytes.

const WIRE_FIELDS = [
  "event_id",
  "delivery_id",
  "ts",
  "delivered_at",
  "sent_at",
  "type",
  "status",
  "amount",
  "currency",
  "consumer_id",
  "consumer_name",
  "merchant_id",
  "merchant_name",
  "counterparty_id",
  "counterparty_name",
  "channel",
  "partition_no",
] as const;

const encoder = new TextEncoder();

/** Encodes a delivered row as wire JSON. Answer-key fields never appear: only the listed
 * fields are written, whatever else the row carries (FR-021 v1). Missing optional fields
 * become `null`. */
export function encodeWirePayload(payload: Record<string, unknown>): Uint8Array {
  const wire: Record<string, unknown> = {};
  for (const field of WIRE_FIELDS) wire[field] = payload[field] ?? null;
  return encoder.encode(JSON.stringify(wire));
}

/** The value a broker partitions on: `payload[field]` (`consumer_id` by default), falling back
 * to `event_id` so a missing field never produces an unkeyed message. */
export function partitionKeyOf(payload: Record<string, unknown>, field = "consumer_id"): string {
  const value = payload[field];
  return typeof value === "string" && value.length > 0 ? value : String(payload.event_id);
}
