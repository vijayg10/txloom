# Key Features

## A Simulated World

TxLoom does not generate rows. It simulates causes and emits their consequences.

**What the world contains:**

| Element | Configured by |
|---|---|
| Consumers | Count, plus weighted archetypes with an income pattern and a spend rhythm |
| Merchants | Count, plus weighted categories with an amount distribution |
| Calendar | Start date, number of history days, weekend multipliers, seasonality windows |
| Fraud actors | Target fraud rate, plus a weighted mix of typologies |
| Outcomes | Baseline decline rate for legitimate traffic |

**Readable parties.** Consumers and merchants get stable display names from a locale name pack (`en-IN` and `en-US` ship), so events read like "Aditya Rathore → Ambika Electronics Corner".

**Event types:** `payment`, `p2p_transfer`, `income_credit`, `refund`. **Statuses:** `approved`, `declined`, `reversed`.

---

## Fraud Typologies with Ground Truth

Three typologies ship. Each is a multi-step campaign run by an actor.

| Typology | Behavior |
|---|---|
| Card testing | A burst of small payments inside a short window. Most are declined; the last step is the most likely to succeed. |
| Account takeover | A consumer goes dormant for a configured number of days, then the account is drained through a sequence of P2P transfers. |
| Refund abuse | An actor requests refunds against a consumer's recent purchases, up to a per-actor limit. |

**Every event is labeled** with `is_fraud`, `typology`, `actor_id` and `campaign_step`.

**The target rate is met by feedback.** The planner tracks how much fraud is owed against legitimate volume so far and plans the shortfall each simulated day. The realism report shows the achieved rate next to the target.

---

## The Answer Key Stays Separate

No label field ever appears in an event payload. Labels live in their own files and, for live streams, on an opt-in label channel.

- Exports exclude labels unless you ask for them and acknowledge a warning
- For streams, labels go to a separate Kafka topic or RabbitMQ routing key, and are always mirrored to a file in the run's output folder

This keeps the answer key away from the system you are testing.

---

## Labeled Imperfections

Real feeds are messy. TxLoom injects four kinds of fault into what each sink receives, at rates you set (up to 20% each).

| Imperfection | Effect on the delivered copy |
|---|---|
| Duplicate delivery | Extra copies follow the original. They share its `event_id` and carry a new `delivery_id`. |
| Late arrival | The event is physically delivered later. Its `ts` stays the event time; `delivered_at` carries the arrival time. |
| Out of order | The next delivery overtakes the flagged one. |
| Clock skew | A per-source offset is added to `ts`. |

**The truth is never touched.** Imperfections apply to a sink's delivered copy only.

**Each sink is independent.** Every sink draws from its own random stream, so adding a sink does not change what another sink receives. An imperfection can target a list of sinks or all of them.

**Every fault is in the answer key**, so a deduplication or ordering check has an exact expected result.

---

## History-to-Live Streaming

A `history_then_live` run generates its history, then continues **the same world** as a live stream from an end-of-history checkpoint.

- Live traffic includes income credits and labeled fraud campaigns
- It follows the weekday rhythm and seasonality of the spec
- It carries the spec's imperfections per sink
- It is stamped with simulated time, starting where history ended

**Replay.** Optionally, the whole generated history is first sent to each broker destination. The live stream starts when every replay is done.

**Sessions.** Stopping and starting a stream opens a new session that carries on from the same world state.

---

## Four Delivery Sinks

| Sink | Notes |
|---|---|
| Files | CSV, Parquet or JSON, written during generation |
| Kafka | PLAINTEXT, SSL, SASL with PLAIN or SCRAM, optional CA certificate. Keyed by `consumer_id` by default. |
| RabbitMQ | Direct, topic or fanout exchange, optional TLS, publisher confirms |
| Webhook | HTTP POST of JSON, with custom headers, timeout and attempt limit |

**Acknowledged delivery.** A message counts as delivered only when the destination acknowledges it: a Kafka delivery report, a RabbitMQ publisher confirm, an HTTP 2xx.

**Retries and drops.** Failed deliveries are retried with jittered backoff. One that is given up on is written to the answer key with `delivery_outcome: "dropped"`.

---

## Honest Stream Health

The stream console reports what is actually happening at the destination.

- Achieved throughput against the target
- Sink lag, in messages owed
- The paced rate, which halves under backpressure and climbs back when the destination recovers
- Failed delivery count
- An error state if the destination stays down

The target rate can be changed while the stream runs.

---

## Deterministic and Reproducible

**Same seed + same spec = byte-identical output.** This holds for the data, the labels and the display names, and it does not depend on how many worker threads generated the run.

- Seeds are exact 64-bit values
- A completed run is an immutable record: spec snapshot, seed and engine version are permanently linked
- **Regenerate exactly this dataset** is a button
- Each run records its engine version. A run made by a different engine version is not silently regenerated with different output; TxLoom tells you the versions differ.

---

## Validation Before Anything Runs

A spec is checked against a JSON Schema and a set of semantic invariants. Each violation has a JSON Pointer path, a machine-readable code and a remedy.

**Examples of what is caught:**

- A seasonality window that falls outside the simulation clock
- Archetype weights, category weights or typology shares that do not sum to 1
- An account-takeover dormancy longer than the simulation
- An imperfection that targets a sink the spec does not declare

The editor, the API, the CLI and the MCP server all use the same validator, so an AI agent can repair a draft from the same errors a person sees.

---

## The Studio

Everything is operable from the web UI. Nothing requires editing a file on disk.

- **Scenarios**: template gallery, JSON editor with inline validation, structural preview, version history with compare and rollback
- **Runs**: launch drawer with an estimate, progress, pause, resume, cancel, retry, regenerate
- **Live**: stream console with rate control and health
- **Inspect**: charts, imperfection audit, realism report, run comparison
- **Ground truth**: filterable labeled events and actor stories
- **Export**: CSV, Parquet or JSON, with or without labels
- **Connections**: typed forms with a test button
- **Settings**: global defaults and agent connection details

---

## Agent-First Authoring

TxLoom ships an MCP server at `/mcp` with 17 tools that cover the whole workflow: read the schema and authoring docs, validate and estimate a spec, create scenarios and versions, launch and retry runs, start and stop streams, read the realism report and ground truth, and build exports.

Every tool maps onto a REST endpoint. An agent can do nothing that a person cannot do in the studio.

---

## CLI

A `txloom` command-line client covers the same API for scripts and CI: validate a spec, launch a run, control runs and streams, browse ground truth, build exports and manage connections.
