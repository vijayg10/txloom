# Wire Format: Delivered Events and Label Channel

**Date**: 2026-10-10 | **Plan**: [../plan.md](../plan.md) | **Research**: R9, R14

This format applies to every delivered copy: Kafka message values, RabbitMQ bodies, webhook
POST bodies, the `delivered/<sink>/part-*.parquet` rows, and file-sink exports. It is UTF-8
JSON on brokers and webhooks, and the same columns in Parquet, CSV and JSON files.

## Event payload

| Field               | Type            | Meaning                                                                                                                           |
| ------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `event_id`          | string (ULID)   | Truth identity. Shared by duplicates.                                                                                             |
| `delivery_id`       | string (ULID)   | Unique per physical delivery. A crash-resume re-publish reuses it (R7).                                                           |
| `ts`                | ISO-8601 UTC    | **Event time as reported by the source**: truth `ts`, plus the clock-skew offset when skewed. Simulated time, never wall-clock.   |
| `delivered_at`      | ISO-8601 UTC    | **New.** Simulated arrival time: `ts_truth + late delay` when late, otherwise equal to truth `ts`.                                |
| `sent_at`           | ISO-8601 \| null | **New.** Wall-clock publish time (live). `null` in files and history replay.                                                     |
| `type`              | enum            | `payment \| p2p_transfer \| income_credit \| refund`                                                                              |
| `status`            | enum            | `approved \| declined \| reversed`                                                                                                |
| `amount`            | number          |                                                                                                                                   |
| `currency`          | string          |                                                                                                                                   |
| `consumer_id`, `consumer_name` | string |                                                                                                                                   |
| `merchant_id`, `merchant_name` | string \| null |                                                                                                                         |
| `counterparty_id`, `counterparty_name` | string \| null |                                                                                                         |
| `channel`           | string          |                                                                                                                                   |
| `partition_no`      | int             | Generation partition (kept for `analytics-flink` compatibility).                                                                  |

No answer-key field (`is_fraud`, `typology`, `actor_id`, `campaign_step`, `corruption_*`)
ever appears in the event payload (FR-021 v1).

**Kafka specifics.** The message key is `payload[partition_key_field]`, `consumer_id` by
default. The message timestamp uses the broker or producer default, which is wall-clock.
Headers carry `txloom-run-id`, `txloom-session-seq` and `txloom-engine-version`.

**Delivery order.** Events are emitted in ascending `delivered_at`, with two deliberate
exceptions: `out_of_order` swaps, and duplicates, which follow their primary immediately.

## Label channel (opt-in, FR-030a / FR-044)

The label channel goes to `destination.label_topic` (Kafka) or `label_routing_key` (RabbitMQ),
and is always mirrored to `runs/<id>/stream-labels.jsonl`. It carries one message per label:

```json
{ "event_id": "…", "delivery_id": "…|null", "sink": "events",
  "is_fraud": true, "typology": "account_takeover", "actor_id": "actor_p3_17", "campaign_step": 2,
  "corruption_type": null | "duplicate" | "late" | "out_of_order" | "clock_skew",
  "delivery_outcome": null | "dropped",
  "corruption_detail": { … } | null }
```

## Breaking change versus engine v1 (introduced with the US2 engine-version bump)

| Engine v1                                       | After this feature                                         |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `ts` = truth + late delay + skew (delivery time) | `ts` = truth + skew (source event time); `delivered_at` new |
| late events kept their file position            | late events are physically emitted later                    |
| live labels always `is_fraud=false`             | live carries fraud and corruption labels                    |

**Downstream impact.** In `analytics-flink/`, `CleanAndOrderJob` and `Event.java` must read
`delivered_at` (`EpochMillisJson`) wherever they treated `ts` as arrival time. The
`analytics-flink/README.md` note about `ts` must be updated too. Both changes are tracked as
tasks.
