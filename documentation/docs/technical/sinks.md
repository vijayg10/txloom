# Sinks & Wire Format

A spec declares its outputs as named sinks. There are four types: `file`, `kafka`, `rabbitmq` and `webhook`.

## Sinks, Connections and Destinations

| Term | Where it lives | What it is |
|---|---|---|
| Sink | The spec | A named output with a type and a format |
| Connection | Saved in TxLoom | A broker or webhook endpoint with its credentials |
| Destination | A run | The binding of one sink to one connection, with an optional topic or routing key |

A spec never contains addresses or credentials. At launch, each non-file sink is bound to a connection of the same type. The binding is remembered per scenario for the next launch.

## The Four Sinks

### Files

File sinks are written by the generation pipeline itself, as each partition is generated. The Export tab then builds CSV, Parquet or JSON downloads from the truth or from a file sink's delivered copy.

### Kafka

- Producer built on librdkafka
- Security: `PLAINTEXT`, `SSL`, `SASL_PLAINTEXT`, `SASL_SSL`, with SASL `PLAIN`, `SCRAM-SHA-256` or `SCRAM-SHA-512`, and an optional CA certificate
- Message key: the event's `consumer_id` by default (configurable with `partition_key_field`), so one consumer's events keep their order within a partition
- Headers: `txloom-run-id`, `txloom-session-seq`, `txloom-engine-version`
- A publish is complete when the delivery report arrives
- Up to 1,000 messages in flight

### RabbitMQ

- Publishes to a `direct`, `topic` or `fanout` exchange with a routing key
- Uses a confirm channel; a publish is complete when the broker confirms it
- Messages are persistent
- Optional TLS with a CA certificate
- Up to 256 messages in flight

### Webhook

- Each event is an HTTP `POST` with a JSON body and `content-type: application/json`
- Extra headers can be stored as secrets
- A publish is complete on an HTTP 2xx
- `408`, `429` and `5xx` responses are retried; other `4xx` responses are not
- Up to 32 requests in flight, so a receiver can see requests out of generation order

---

## The Delivery Pump

Broker sinks make one attempt per message. Everything else is handled by a shared delivery pump:

- **In-flight window.** At most the sink's limit of unacknowledged messages is outstanding.
- **Retries.** Retryable failures are retried with jittered exponential backoff (from 200 ms up to 30 s), up to 5 attempts by default.
- **Drops.** A delivery that runs out of attempts is recorded in the answer key with `delivery_outcome: "dropped"`.
- **Circuit breaker.** If more than half of the completions in the last 30 seconds failed (with at least 100 completions), the stream enters an error state and stays there until it is stopped.

Delivered counts mean acknowledged messages.

### Pacing a live stream

A live stream is released at the target rate from a token bucket. On backpressure (a full in-flight window, a saturated transport, a throttled publish) the paced rate is halved, at most once a second. Every quiet second adds 5% of the target back. The stream console shows the target, the paced rate and the achieved rate.

### Replaying history

With **Replay history**, a sink's delivered history is published unpaced, in the order it was written, before the live stream starts. Progress is saved every 10,000 rows, so a retry resumes from the last saved position instead of starting over. A failed replay can be retried or skipped.

---

## Wire Format

Every sink carries the same event payload: UTF-8 JSON on brokers and webhooks, and the same columns in Parquet, CSV and JSON files.

| Field | Type | Meaning |
|---|---|---|
| `event_id` | string (ULID) | Identity of the truth event. Shared by duplicates. |
| `delivery_id` | string (ULID) | Unique per physical delivery |
| `ts` | ISO-8601 UTC | Event time as the source reported it: the truth time, plus the clock-skew offset when skewed. Simulated time. |
| `delivered_at` | ISO-8601 UTC | Simulated arrival time: truth time plus the late-arrival delay, otherwise equal to truth time |
| `sent_at` | ISO-8601 or null | Wall-clock publish time on a live stream. `null` in files and history replay. |
| `type` | enum | `payment`, `p2p_transfer`, `income_credit`, `refund` |
| `status` | enum | `approved`, `declined`, `reversed` |
| `amount` | number | |
| `currency` | string | |
| `consumer_id`, `consumer_name` | string | |
| `merchant_id`, `merchant_name` | string or null | |
| `counterparty_id`, `counterparty_name` | string or null | |
| `channel` | string | From the spec |
| `partition_no` | integer | Generation partition |

No label field (`is_fraud`, `typology`, `actor_id`, `campaign_step`, or any corruption field) ever appears in the event payload.

### Reading the time fields

- Use **`ts`** as the event time your pipeline would see from the source. It can be skewed.
- Use **`delivered_at`** as arrival time. A late event has `delivered_at` after `ts` and is physically delivered later.
- **`sent_at`** tells you when a live message was actually published.

### Delivery order

Events are emitted in ascending `delivered_at`, with two deliberate exceptions: out-of-order swaps, and duplicates, which follow their original immediately.

---

## Label Channel

Labels can be streamed alongside a live run. The channel is opt-in at launch.

- **Kafka**: a separate label topic
- **RabbitMQ**: a separate label routing key
- **Always**: mirrored to `stream-labels.jsonl` in the run's folder

One message per label:

```json
{
  "event_id": "01KDVDNA85XZA38G75X20S2CGA",
  "delivery_id": "01KDVDNA86B2M4Q7T9W1Y3Z5C7",
  "sink": "upi-stream",
  "is_fraud": true,
  "typology": "account_takeover",
  "actor_id": "actor_p0_34",
  "campaign_step": 2,
  "corruption_type": null,
  "delivery_outcome": null,
  "corruption_detail": null
}
```

| Field | Values |
|---|---|
| `corruption_type` | `null`, `duplicate`, `late`, `out_of_order`, `clock_skew` |
| `delivery_outcome` | `null`, or `dropped` when the pump gave up on the delivery |

Join labels to events on `event_id`, and to one physical delivery on `delivery_id`.

---

## Writing a New Sink

Broker sinks implement a small plugin interface: `publish`, `probe` and `close`, plus an in-flight limit. Retries, backoff and backpressure come from the pump. The steps and the full interface are in [Extending TxLoom](./extending.md).
