# Scenario Spec

A scenario spec is the JSON document a run is generated from. It describes the world, the fraud, the imperfections and the outputs. It is validated before anything runs, versioned in the scenario's history, and snapshotted into every run.

You can write it in the studio editor, start from a template, or have an AI agent write it through the MCP server.

## A Complete Example

A small UPI-style scenario with all three fraud typologies, two imperfections and one Kafka sink:

```json
{
  "seed": 20260101,
  "currency": "INR",
  "locale": "en-IN",
  "channel": "upi",
  "clock": { "start": "2026-01-01", "days": 90, "then_stream_tps": 50 },
  "population": {
    "consumers": {
      "count": 5000,
      "archetypes": [
        {
          "name": "salaried",
          "weight": 0.55,
          "income_pattern": { "kind": "fixed_credit_day", "day_of_month": 1, "amount_mean": 60000, "amount_stddev": 15000 },
          "spend_rhythm": { "daily_transaction_count_mean": 2.5, "daily_transaction_count_stddev": 1.2, "weekend_multiplier": 1.4 }
        },
        {
          "name": "gig_worker",
          "weight": 0.45,
          "income_pattern": { "kind": "irregular_weekly", "amount_mean": 9000, "amount_stddev": 3000 },
          "spend_rhythm": { "daily_transaction_count_mean": 3.5, "daily_transaction_count_stddev": 1.5, "weekend_multiplier": 1.1 }
        }
      ]
    },
    "merchants": {
      "count": 400,
      "categories": {
        "grocery": { "name": "grocery", "weight": 0.6, "amount_distribution": { "kind": "lognormal", "mean": 400, "stddev": 150 } },
        "fuel": { "name": "fuel", "weight": 0.4, "amount_distribution": { "kind": "normal", "mean": 800, "stddev": 300 } }
      }
    }
  },
  "seasonality": [
    { "event": "diwali", "window": ["2026-02-10", "2026-02-17"], "volume_multiplier": 2.2 }
  ],
  "fraud": {
    "target_rate": 0.015,
    "typologies": [
      { "type": "card_testing", "share": 0.4, "params": { "burst_size_min": 3, "burst_size_max": 8, "burst_window_minutes": 4, "amount_min": 1, "amount_max": 25 } },
      { "type": "account_takeover", "share": 0.4, "params": { "dormancy_days": 45, "drain_step_count": 4 } },
      { "type": "refund_abuse", "share": 0.2, "params": { "refund_rate": 0.25, "max_refunds_per_actor": 4 } }
    ]
  },
  "outcomes": { "baseline_decline_rate": 0.02 },
  "imperfections": {
    "duplicate_delivery": { "rate": 0.01, "sinks": ["upi-stream"] },
    "late_arrival": { "rate": 0.03, "delay_seconds_mean": 20, "delay_seconds_stddev": 8, "sinks": ["upi-stream"] }
  },
  "output": {
    "sinks": [{ "type": "kafka", "name": "upi-stream", "format": "json" }],
    "labels": "separate_export"
  }
}
```

The four gallery templates are complete worked examples. They are also listed in the [agent reference](../technical/agent-reference.md).

---

## Top Level

| Field | Type | Description |
|---|---|---|
| `seed` | integer | 0 to 9007199254740991. The same seed and spec always reproduce byte-identical output. Larger 64-bit seeds can be passed at launch. |
| `currency` | string | ISO 4217 code, for example `INR` or `USD`. One currency per scenario. |
| `locale` | string | Name pack for consumer and merchant display names. Shipped: `en-IN`, `en-US`. |
| `channel` | string | Free-text label stamped on every event, for example `upi`, `card_present`, `wallet`. |
| `clock` | object | [Simulation clock](#clock) |
| `population` | object | [Consumers and merchants](#population) |
| `seasonality` | array | [Volume windows](#seasonality). May be empty. |
| `fraud` | object | [Fraud rate and typologies](#fraud) |
| `outcomes` | object | [Decline rate](#outcomes) |
| `imperfections` | object | [Delivery faults](#imperfections). May be empty. |
| `output` | object | [Sinks and label handling](#output) |

## Clock

| Field | Description |
|---|---|
| `start` | ISO date the history begins, for example `"2026-01-01"` |
| `days` | Length of the history in days, at least 1 |
| `then_stream_tps` | Optional. If set, the run can continue as a live stream at this target rate. Omit for a files-only scenario. |

## Population

### Consumers

| Field | Description |
|---|---|
| `count` | Number of consumers |
| `archetypes[].name` | Archetype name |
| `archetypes[].weight` | Share of the population. All weights must sum to 1. |
| `archetypes[].income_pattern.kind` | `fixed_credit_day` (salaried; needs `day_of_month`, 1 to 28) or `irregular_weekly` (gig work) |
| `archetypes[].income_pattern.amount_mean`, `amount_stddev` | Income amount |
| `archetypes[].spend_rhythm.daily_transaction_count_mean`, `daily_transaction_count_stddev` | Transactions per day |
| `archetypes[].spend_rhythm.weekend_multiplier` | Multiplier applied on Saturday and Sunday |

### Merchants

| Field | Description |
|---|---|
| `count` | Number of merchants |
| `categories` | Object keyed by category name |
| `categories.<key>.name` | Category name |
| `categories.<key>.weight` | Share of merchants. All weights must sum to 1. |
| `categories.<key>.amount_distribution.kind` | `lognormal`, `normal` or `exponential` |
| `categories.<key>.amount_distribution.mean`, `stddev` | Payment amount. `stddev` is not used by `exponential`. |

## Seasonality

Each entry raises (or lowers) volume inside a date window.

| Field | Description |
|---|---|
| `event` | Label shown on the volume chart |
| `window` | `[startDate, endDate]`. Must overlap the simulation clock. |
| `volume_multiplier` | Factor applied to volume inside the window |

## Fraud

| Field | Description |
|---|---|
| `target_rate` | Share of events that are fraud, 0 to 0.5 |
| `typologies[].type` | `card_testing`, `account_takeover` or `refund_abuse` |
| `typologies[].share` | Share of fraud given to this typology. Shares must sum to 1. |
| `typologies[].params` | Depends on the type, see below |

**Card testing**

| Param | Description |
|---|---|
| `burst_size_min`, `burst_size_max` | Number of probe payments in a burst |
| `burst_window_minutes` | Time window the burst falls in |
| `amount_min`, `amount_max` | Amount range of each probe |

**Account takeover**

| Param | Description |
|---|---|
| `dormancy_days` | Days the victim's account is dormant before the attack. Must be less than `clock.days`. |
| `drain_step_count` | Number of draining P2P transfers |

**Refund abuse**

| Param | Description |
|---|---|
| `refund_rate` | Rate at which the actor requests refunds |
| `max_refunds_per_actor` | Cap on refunds per actor |

## Outcomes

| Field | Description |
|---|---|
| `baseline_decline_rate` | Share of legitimate events that are declined, 0 to 1 |

## Imperfections

Every imperfection takes a `rate` from 0 to 0.2 and an optional `sinks` list of sink names. Leave `sinks` out to apply it to every sink.

| Key | Extra fields | Effect |
|---|---|---|
| `duplicate_delivery` | | Extra copies of an event are delivered |
| `late_arrival` | `delay_seconds_mean`, `delay_seconds_stddev` | The event is delivered later than it happened |
| `out_of_order` | | The next delivery overtakes this one |
| `clock_skew` | `sources[]` of `{ source, offset_seconds }` | The named sink's event times are shifted by the offset. `source` must be a declared sink name. |

## Output

| Field | Description |
|---|---|
| `sinks[].type` | `file`, `kafka`, `rabbitmq` or `webhook` |
| `sinks[].name` | Unique name. Imperfections and launch destinations refer to it. |
| `sinks[].format` | `csv`, `parquet` or `json` |
| `labels` | `separate_export` (recommended) keeps the answer key out of the main export. `merged_with_warning` allows a merged export after the warning is acknowledged. |
| `stream_label_channel` | Optional boolean. Enables the label channel for live streams. |

A spec names sinks by type only. Broker addresses and credentials live in [connections](./configuration.md#connections), and each non-file sink is bound to one at launch.

---

## Validation

A spec is checked against the JSON Schema, then against the semantic invariants below. Each violation is reported with a JSON Pointer path, a code and a message.

### Errors

| Code | Rule |
|---|---|
| `seed-out-of-range` | `seed` must be an integer from 0 to 9007199254740991 |
| `seasonality-window-outside-clock` | Every seasonality window must overlap the simulation clock |
| `archetype-weights-not-normalized` | Archetype weights must sum to 1 |
| `merchant-category-weights-not-normalized` | Merchant category weights must sum to 1 |
| `fraud-typology-shares-not-normalized` | Typology shares must sum to 1 |
| `fraud-rate-out-of-bounds` | `fraud.target_rate` must be between 0 and 0.5 |
| `dormancy-not-satisfiable` | `dormancy_days` must be less than `clock.days` |
| `imperfection-rate-out-of-bounds` | Every imperfection rate must be between 0 and 0.2 |
| `imperfection-sink-not-declared` | An imperfection's `sinks` must name declared sinks |
| `clock-skew-source-not-declared` | A clock-skew `source` must name a declared sink |
| `locale-pack-not-found` | `locale` must be a shipped name pack |

### Warnings

Warnings do not block a run.

| Code | Meaning |
|---|---|
| `population-above-reference-scale` | More than 200,000 consumers or 5,000 merchants. Generation works, but is outside the benchmarked range. |
| `stream-tps-above-benchmark` | `then_stream_tps` above 1,000. Delivery at that rate is not covered by the published benchmark. |

### Ways to validate

- **Studio**: errors appear inline in the editor as you type
- **CLI**: `txloom validate spec.json`
- **API**: `POST /api/v1/spec/validate` with `{ "spec": { ... } }`
- **MCP**: the `validate_spec` tool

The JSON Schema itself is served at `GET /api/v1/spec/schema`.

---

## Sizing a Scenario

The launch drawer and `POST /api/v1/spec/estimate` report the expected number of history events, partitions and generation time before you launch.

As a reference point, the UPI template (5,000 consumers, 400 merchants, 90 days) produces about 1.3 million history events.
