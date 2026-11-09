# Key Features

## A Simulated World

TxLoom simulates causes and emits their consequences, so every transaction is the result of something that happened in its world.

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

**The fraud rate you set is the rate you get.** Fraud arrives in campaigns of several events, so TxLoom doesn't fix a fraud budget up front. Instead, at the start of each simulated day it compares the fraud generated so far with what the target rate calls for, and schedules enough new campaigns to close the gap. The realism report shows the achieved rate next to the target.

---

## The Answer Key Stays Separate

Labels are never mixed into the events your system receives. They are kept in separate files, and an export gives you the labels as their own file unless you choose to merge them into the data.

This keeps the answer key away from the system you are testing.

---

## Labeled Imperfections

Real feeds are messy. TxLoom injects four kinds of fault into what each sink receives, at rates you set (up to 20% each).

| Imperfection | Effect on the delivered copy |
|---|---|
| Duplicate delivery | An extra copy follows the original. It shares its `event_id` and carries a new `delivery_id`. |
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

**Replay.** Optionally, the whole generated history is first sent to each connected destination (Kafka, RabbitMQ or webhook). The live stream starts when every replay is done.

**Sessions.** Stopping and starting a stream opens a new session that carries on from the same world state.

---

## Four Delivery Sinks

| Sink | Notes |
|---|---|
| Files | Each sink's delivered copy is written as Parquet during generation. Export it as CSV, Parquet or JSON. |
| Kafka | PLAINTEXT, SSL, SASL with PLAIN or SCRAM, optional CA certificate. |
| RabbitMQ | Direct, topic or fanout exchange, optional TLS, publisher confirms |
| Webhook | HTTP POST of JSON, with custom headers, timeout and attempt limit |

**Acknowledged delivery.** A message counts as delivered only when the destination acknowledges it: a Kafka delivery report, a RabbitMQ publisher confirm, an HTTP 2xx.

**Retries and drops.** Failed deliveries are retried with jittered backoff. One that is given up on is written to the answer key with `delivery_outcome: "dropped"`.

**Drive your own load.** A Kafka or RabbitMQ stream can feed a load generator you write yourself. It consumes TxLoom's events and turns each one into the requests, messages or API calls your system expects, at the rate the stream sets.

---

## Live Stream Monitoring

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

Every spec is checked before it can run. Each error points to the exact field that is wrong and says how to fix it, for example weights that don't add up to 1 or a seasonality window outside the simulated dates.

People and AI agents see the same errors, whether they use the studio, the API, the CLI or the MCP server.

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
