# TxLoom architecture review: generation-to-publication flow, gaps, and proposed changes

- **Date:** 2026-10-10
- **Reviewed at:** commit `9882a84` (`main`)
- **Scope:** the path from scenario creation to synthetic events landing in a sink
  (files, Kafka, RabbitMQ, webhook), the web UI for that path, and where Kafka
  endpoints are configured.
- **Status:** findings and proposals only. No code has been changed. Next step is
  a clickable UI prototype (see [§7](#7-next-step)).

**How this was verified.** Every finding below comes from reading the code at
the cited lines. Three were also checked by running code:

- generation timing and memory at increasing population sizes (G5, G6);
- the cost of the merchant-pool random-number setup (G11);
- whether two different seeds produce the same output (G10).

BullMQ behaviour that some findings depend on (duplicate job IDs, default
concurrency, stalled-job handling) was checked against the BullMQ docs. The
benchmark scripts were throwaway and are not in the repo; numbers come from one
developer laptop and are only meaningful relative to each other.

---

## Contents

1. [How the flow works today](#1-how-the-flow-works-today)
2. [Gaps: engine, workers, and delivery](#2-gaps-engine-workers-and-delivery)
3. [Gaps: UI flow](#3-gaps-ui-flow)
4. [Gaps: Kafka endpoint configuration](#4-gaps-kafka-endpoint-configuration)
5. [Proposed changes](#5-proposed-changes)
6. [Sequencing, tradeoffs, and open questions](#6-sequencing-tradeoffs-and-open-questions)
7. [Next step](#7-next-step)

---

## 1. How the flow works today

1. **Author a scenario.** The web UI, the CLI and the MCP server are all clients
   of one Fastify REST API. The MCP tools inject requests into the same routes
   ([scenario-tools.ts](../apps/api/src/mcp/tools/scenario-tools.ts)). A scenario
   is created blank or cloned from a template
   ([scenarios.ts:33-65](../apps/api/src/routes/scenarios.ts#L33-L65)).
2. **Save a spec version.** `POST /scenarios/:id/versions` validates the spec
   (JSON Schema plus semantic invariants), stores it as a new version and points
   the scenario at it
   ([spec-versions.ts:20-42](../apps/api/src/routes/spec-versions.ts#L20-L42)).
3. **Launch a run.** `POST /scenarios/:id/runs` copies the current spec into the
   run record, chooses a seed, derives a partition count (about 20k consumers per
   partition), builds the shared merchant pool, and queues one
   `generate-partition` BullMQ job per partition
   ([run-launch-service.ts](../apps/api/src/services/run-launch-service.ts)).
4. **Generate each partition.** The job hands the work to a Piscina worker thread
   ([partition-worker.ts](../apps/worker/src/pool/partition-worker.ts)). That
   thread:
   - generates consumers, a day-by-day loop of income and spending (with weekend
     and seasonality effects), and fraud campaigns
     ([truth-emit.ts](../packages/engine/src/truth-emit.ts),
     [orchestrator.ts](../packages/engine/src/fraud/orchestrator.ts));
   - produces **truth events** and **label records** (the answer key);
   - applies imperfections (duplicates, late arrival, clock skew, out-of-order)
     to a separate delivered copy per spec sink
     ([pipeline.ts](../packages/engine/src/imperfections/pipeline.ts));
   - writes `truth/`, `labels/` and `delivered/<sink>/` Parquet files, plus
     per-partition statistics for the realism report.
5. **Complete the run.** When every partition is done, the worker marks the run
   `completed` and queues `report-build`
   ([worker index.ts:48-62](../apps/worker/src/index.ts#L48-L62)).
6. **Export** (files). `POST /runs/:id/exports` converts `truth/` and `labels/`
   to CSV, JSON or Parquet
   ([export-service.ts](../apps/api/src/services/export-service.ts)).
7. **Stream** (Kafka, RabbitMQ, webhook). This is a separate, manual step that is
   only allowed on a completed run. `POST /runs/:id/stream/start` takes an inline
   sink config and queues a `stream-drive` job
   ([stream-control.ts](../apps/api/src/routes/stream-control.ts)). The job:
   - rebuilds each partition's end-of-history state by re-running generation;
   - draws live events with a token-bucket rate limiter;
   - publishes each event through the `Sink` interface
     ([stream-drive.ts](../apps/worker/src/jobs/stream-drive.ts),
     [interface.ts](../packages/sinks/src/interface.ts)).

**Corrections to the earlier informal summary of this flow:**

- Batch runs never publish to Kafka, RabbitMQ or webhooks; only streaming does.
- Imperfections never reach any consumer of the data (G1).
- The live stream is not a continuation of the same simulated behaviour (G2).
- Partitions do not run in parallel within a worker process (G4).

---

## 2. Gaps: engine, workers, and delivery

Severity:
- **High**: breaks a headline feature, or fails at the documented reference
  scale (200k consumers, 5k merchants, 90 days, 1,000 TPS).
- **Medium**: wrong or fragile behaviour with a workaround or limited blast
  radius.
- **Realism**: weakens how believable the data is.

### High

#### G1. Imperfections never reach a consumer, and the answer key describes corruptions that aren't in the data

- **Evidence:**
  - Delivered copies with imperfections applied go only to
    `delivered/<sink>/*.parquet`
    ([partition-worker.ts:85-97](../apps/worker/src/pool/partition-worker.ts#L85-L97)).
    Only the e2e tests read that directory.
  - Exports read `truth/`, not `delivered/`
    ([export-service.ts:84-105](../apps/api/src/services/export-service.ts#L84-L105)).
  - The live stream never calls `applyImperfections`.
  - The exported `labels` file still contains the corruption rows
    (`corruption_type`: duplicate, late, and so on).
- **Impact:** the "labeled imperfection engine", one of the six listed
  differentiators, has no effect on any output a user receives. Anyone testing
  deduplication against the answer key will find labeled duplicates that don't
  exist in the data.
- **Fix:** add a real delivery stage (P2.1) and use one shared imperfection
  transformer for both batch and live (P3.3).

#### G2. The live stream is not "the same world continued"

- **Evidence:** `drawNextLiveEvent`
  ([live-world.ts:61-93](../packages/engine/src/streaming/live-world.ts#L61-L93)):
  - picks consumers and merchants uniformly at random;
  - emits only `payment` events, with no income credits and no weekend or
    seasonality effects;
  - emits no fraud, so every live label is `is_fraud=false`
    ([live-world.ts:97-108](../packages/engine/src/streaming/live-world.ts#L97-L108));
  - uses wall-clock timestamps. If the history window ends in the future, live
    events are timestamped *inside* that window; if it ends in the past, there
    is a gap.

  Only the population and the random-number state carry over from history.
- **Impact:** the "history-to-live continuity" differentiator is only partly
  delivered, and streams can't be used to test fraud detection.
- **Fix:** P3.1 and P3.4.

#### G3. Batch runs never reach a broker; run parameters and modes are inert; streams can't authenticate

- **Evidence:**
  - `sink_connection_ids`, `label_export` and `stream_label_channel` are saved on
    the run but never read
    ([runs-launch.ts:54-58](../apps/api/src/routes/runs-launch.ts#L54-L58)).
  - `mode: "batch_then_stream"` is stored but nothing acts on it. Streaming
    always needs a manual `stream/start` after completion.
  - The stream sink is given inline in the request, and credentials are
    hard-coded to `null`
    ([stream-drive.ts:63-72](../apps/worker/src/jobs/stream-drive.ts#L63-L72)).
    The stored, encrypted sink connections are only used by the test-connection
    route.
- **Impact:** you can't stream to any authenticated Kafka cluster (MSK,
  Confluent Cloud, and so on). The launch options promise behaviour that doesn't
  happen.
- **Fix:** P2.1, P2.2, P2.3.

#### G4. No parallelism inside a worker process; one stream blocks all others

- **Evidence:** none of the BullMQ `Worker`s set `concurrency`, so each defaults
  to 1
  ([generate-partition.ts:33-62](../apps/worker/src/jobs/generate-partition.ts#L33-L62),
  [stream-drive.ts:90-164](../apps/worker/src/jobs/stream-drive.ts#L90-L164)).
- **Impact:**
  - Partitions run one at a time per worker process, so the Piscina thread pool
    mostly sits idle.
  - Stream jobs only finish when stopped, so a second run's stream waits in the
    queue for as long as the first one runs.
- **Fix:** P1.4.

#### G5. Refund-abuse generation is quadratic

- **Evidence:** every refund-abuse attempt re-filters the whole partition's
  event list
  ([orchestrator.ts:158-160](../packages/engine/src/fraud/orchestrator.ts#L158-L160)).
- **Measured:** reference fixture spec, 30 days, fraud rate 1.2%, 200 merchants,
  one partition.

  | Consumers | Events  | Without refund abuse | With refund abuse |
  |----------:|--------:|---------------------:|------------------:|
  | 1,000     | 89,345  | 0.56 s               | 1.40 s            |
  | 2,000     | 179,414 | 1.19 s               | 6.50 s            |
  | 4,000     | 357,828 | 2.48 s               | 28.2 s            |

  Time grows about 4.5× each time the population doubles. Extrapolating to one
  reference-sized partition (20k consumers × 90 days, about 5M events) gives
  hours per partition. That figure is an estimate, not a measurement.
- **Fix:** build a map of each consumer's purchases once, before the loop (P1.1).
  This changes generated output, so do it after P0.

#### G6. Each partition is held entirely in memory

- **Evidence:** truth events, label records, and one delivered copy per sink are
  all held in arrays before anything is written
  ([truth-emit.ts:83-179](../packages/engine/src/truth-emit.ts#L83-L179),
  [partition-worker.ts:55-97](../apps/worker/src/pool/partition-worker.ts#L55-L97)).
  The "flat memory" comment on the Parquet writer
  ([parquet.ts:34-37](../packages/sinks/src/file/parquet.ts#L34-L37)) doesn't
  hold, because the rows are already in arrays.
- **Measured:** about 310 MB of heap at 358k events, before imperfection copies.
  A reference partition (about 5M events) would plausibly need several GB per
  thread, and several threads run at once once G4 is fixed. That is an estimate.
- **Fix:** generate one day at a time and stream each day to the writers (P3.1).

#### G7. Starting a stream re-runs the full history on the worker's main thread

- **Evidence:** `resumeLiveWorld` calls `generatePartition` for every partition
  inside the `stream-drive` job
  ([stream-drive.ts:95-99](../apps/worker/src/jobs/stream-drive.ts#L95-L99),
  [live-world.ts:32-47](../packages/engine/src/streaming/live-world.ts#L32-L47)),
  outside the thread pool. The checkpoint column that was reserved to avoid this
  is always written as `null`
  ([worker index.ts:70](../apps/worker/src/index.ts#L70)).
- **Impact:**
  - At scale this blocks the event loop for longer than BullMQ's 30 s job lock.
    BullMQ then treats the job as stalled and restarts it; its docs say such jobs
    are "double processed". The likely result is duplicate streams or a restart
    loop.
  - It also freezes the other workers that share the same process.
- **Fix:** save the end-of-history world state when each partition finishes
  generating, and load it at stream start (P1.3).

#### G8. Restarting a stopped stream silently does nothing

- **Evidence:** the stream job ID is always `stream-${runId}`
  ([stream-control.ts:109-122](../apps/api/src/routes/stream-control.ts#L109-L122)),
  and completed jobs are kept because `removeOnComplete` isn't set anywhere.
  BullMQ ignores a new job whose ID already exists, so the stream's database row
  says `streaming` while nothing is published.
- **Related:** calling `start` while a stream is `paused` adds a job with the
  same ID, which is ignored, so any new sink in the request is silently dropped.
- **Fix:** P1.5.

### Medium

#### G9. The stream delivery loop is fragile

All of the following are in
[stream-drive.ts:109-159](../apps/worker/src/jobs/stream-drive.ts#L109-L159)
unless another file is cited.

- **Serial publishing.** Each `sink.publish` is awaited before the next one, so
  throughput can't exceed 1 / round-trip time.
- **Kafka backpressure never fires.** With serial publishing, at most one send
  is in flight, so the threshold of 100 is never reached
  ([producer.ts:82-99](../packages/sinks/src/kafka/producer.ts#L82-L99)).
- **Backpressure is ignored.** Even when a sink reports backpressure, the rate
  limiter isn't slowed. `sink_lag` is hard-coded to `0`.
- **Webhooks can stall the stream.** `fetch` has no timeout, and the up-to-5
  retries sleep inside the loop
  ([webhook publisher.ts:54-70](../packages/sinks/src/webhook/publisher.ts#L54-L70)).
- **RabbitMQ success isn't confirmed.** A confirm channel is opened but confirms
  are never awaited, so `ok: true` doesn't mean the broker received the message
  ([rabbitmq publisher.ts:69-77](../packages/sinks/src/rabbitmq/publisher.ts#L69-L77)).
- **Failed publishes are dropped but still labeled.** The answer key then
  contains events that were never delivered (lines 126-137).

#### G10. Seeds are silently truncated to 32 bits

- **Evidence:** `foldSeed` keeps only the low 32 bits
  ([rng.ts:43-45](../packages/engine/src/rng.ts#L43-L45)). Verified: seeds `1`
  and `2^32 + 1` produce identical output.
- **Also:** the launch API accepts the seed as a JSON number, which loses
  precision above 2^53.
- **Fix:** either reject seeds outside the 32-bit range, or feed all bits of the
  seed into the generator's 128-bit state (the second option is
  output-changing, so do it after P0). Accept the seed as a string.

#### G11. Merchant-pool setup blocks the API for about 0.7 s on every launch

- **Evidence:** `deriveNamedRng` advances the generator about a million times to
  reach the merchant stream
  ([rng.ts:76-89](../packages/engine/src/rng.ts#L76-L89)). Measured: 670 ms of
  synchronous CPU. It runs on the API event loop on every launch, run resume and
  stream start
  ([run-launch-service.ts:38](../apps/api/src/services/run-launch-service.ts#L38),
  [run-control.ts:73](../apps/api/src/routes/run-control.ts#L73),
  [stream-control.ts:106](../apps/api/src/routes/stream-control.ts#L106)).
- **Also:** the merchant list it produces is copied into every job payload in
  Redis.
- **Fix:** derive named streams by hashing `(seed, name)` into a fresh seed
  instead of advancing the generator (output-changing, so after P0). Have the
  worker rebuild the merchant pool instead of receiving it in each job.

#### G12. "Regenerate exactly this dataset" isn't protected against engine changes

- **Evidence:** runs store the spec and seed, but not an engine version or the
  partition count. Stream start recalculates the partition count instead of
  reading it from `run_partitions`
  ([stream-control.ts:105](../apps/api/src/routes/stream-control.ts#L105)).
- **Impact:** any output-changing fix (G5, G10, G11, P3) silently changes what
  "regenerate" produces for existing runs.
- **Fix:** P0.

#### G13. Run lifecycle gaps

- **Race on small runs.** The run is set to `running` only after its jobs are
  queued
  ([run-launch-service.ts:40-59](../apps/api/src/services/run-launch-service.ts#L40-L59)).
  A tiny run can finish while still `queued`. The completion check then skips
  it ([worker index.ts:52-53](../apps/worker/src/index.ts#L52-L53)), and the run
  stays unfinished until the worker restarts.
- **No retries.** One failed partition fails the whole run
  ([worker index.ts:74-77](../apps/worker/src/index.ts#L74-L77)). No `attempts`
  are configured, and there is no route to retry a failed run; resume only
  accepts `paused` runs.
- **Missing re-validation.** The spec isn't validated again on rollback,
  template clone or launch. A version that became invalid because a rule got
  stricter can still be run.

### Realism

#### G14. Fraud and timing realism

- **Account takeover:**
  - Every campaign starts at the same moment, `clockStart + dormancy_days`
    ([orchestrator.ts:120-121](../packages/engine/src/fraud/orchestrator.ts#L120-L121)).
  - The dormancy condition isn't enforced: the victim keeps spending normally
    during the "dormant" period.
- **No balances.** Nothing tracks account balances, so a "drain" isn't limited
  by the victim's funds and income doesn't fund spending.
- **Flat daily activity.** Times within a day are uniformly random, with no
  daily activity curve
  ([truth-emit.ts:94](../packages/engine/src/truth-emit.ts#L94),
  [truth-emit.ts:121](../packages/engine/src/truth-emit.ts#L121)).

#### G15. Exports with labels included don't scale and lose fields

- **Evidence:** `include_labels` loads every label into an in-memory map
  ([export-service.ts:88-94](../apps/api/src/services/export-service.ts#L88-L94)).
  The merged output keeps only `is_fraud` and `typology` and drops `actor_id`
  and `campaign_step`.

#### G16. The published benchmark doesn't test the reference scale

- **Evidence:** the Kafka benchmark
  ([benchmarks/kafka/lib.ts](../benchmarks/kafka/lib.ts)) uses 2k consumers,
  7 days, no fraud typologies and no imperfections, and drives the stream code
  directly rather than through BullMQ. Batch generation at 200k consumers × 90
  days is never exercised, which is how G5 and G6 went unnoticed.

---

## 3. Gaps: UI flow

### U1. Seven screens and three nav sections to get Kafka events from a template

1. **Scenario workspace.** The template gallery sits below the "New blank
   scenario" form. Clone a template.
2. **Scenario detail.** A raw JSON editor and a "Launch a run" link
   ([scenario-workspace/index.tsx:176-183](../apps/web/src/surfaces/scenario-workspace/index.tsx#L176-L183)).
3. **Launch page.** One "Run" button with no destination, mode, seed or rate
   options
   ([run-launch.tsx:39](../apps/web/src/surfaces/run-control/run-launch.tsx#L39)).
4. **Run detail.** Wait for the run to complete. Nothing links to streaming.
5. **Sidebar → Stream console.** A list of completed runs, shown only as raw IDs
   with no scenario name
   ([stream-console/index.tsx:41-51](../apps/web/src/surfaces/stream-console/index.tsx#L41-L51)).
6. **Stream launcher.** The sink type defaults to Webhook, and the Kafka fields
   are pre-filled with e2e test values
   ([stream-launcher.tsx:22-28](../apps/web/src/surfaces/stream-console/stream-launcher.tsx#L22-L28)).
7. **Stream console.**

### U2. The UI's structure doesn't match how users think about the task

- "Run" and "stream" look like two unrelated products.
- The question users start with, *where should the events go?*, is asked last,
  in a different section.
- Inspector, Ground truth and Stream each start with their own run picker, so
  users keep re-selecting the same run.

### U3. Small rough edges

- Runs are listed by raw ID everywhere.
- Some links use `<a href>`, which reloads the whole app
  ([run-launch.tsx:56-62](../apps/web/src/surfaces/run-control/run-launch.tsx#L56-L62),
  [run-list.tsx:64](../apps/web/src/surfaces/run-control/run-list.tsx#L64)).
- After a template clone, the scenario page doesn't show that version 1 is
  already saved.

---

## 4. Gaps: Kafka endpoint configuration

A Kafka endpoint can be defined in several places that don't know about each
other. The one that stores credentials is the one that never publishes.

| Place | What you can set | Used for publishing? |
|---|---|---|
| Spec `output.sinks[]` ([types.ts:132-137](../packages/spec/src/types.ts#L132-L137)) | `{type: "kafka", name}` only. The name is what imperfections target. | No; it has no address |
| Settings → Sink connections ([sink-management.tsx:157-183](../apps/web/src/surfaces/settings/sink-management.tsx#L157-L183)), CLI `sinks-add` | A raw JSON box with no field hints, plus username/password | **No**; only "Test connection" reads it |
| Stream launcher UI, MCP stream tool, `POST /stream/start` | Brokers and topic typed inline, no credentials | **Yes**, the only path that publishes |
| `docker-compose.yml` demo broker | `kafka:29092` inside Docker, `localhost:9092` from the host | Never registered as a connection |

Other problems:

- Giving credentials forces SSL plus SASL PLAIN. There is no choice of security
  protocol or SCRAM mechanism, and no way to supply a CA certificate
  ([producer.ts:48-57](../packages/sinks/src/kafka/producer.ts#L48-L57)).
- Nothing links the spec's sink name to an actual broker. This is part of why
  imperfections never reach Kafka (G1).
- The inside-Docker vs host address difference catches anyone running the worker
  outside Docker, and nothing in the UI explains it.

---

## 5. Proposed changes

Numbering: `P0`–`P4` are engine and backend phases. `UI-*` are UI changes.
`CONN-*` are connection-configuration changes.

### P0. Version the engine (do this before any output-changing fix)

- Add `engine_version` and `partition_count` to `runs`, and set them at launch.
- `regenerate` and stream start use the stored partition count.
- If the stored engine version differs from the running one, refuse or warn:
  "this run was generated by engine vX; output will differ."
- Treat "same spec + same seed + same engine version → byte-identical output" as
  the stated guarantee.

### P1. Correctness and scale fixes

- **P1.1** Refund abuse: build a map of purchases per consumer once (G5).
  Output-changing.
- **P1.2** Seeds: accept them as strings, and either reject values that don't
  fit in 32 bits or use all their bits (G10). Make named random streams cheap
  (G11). Output-changing.
- **P1.3** Save each partition's end-of-history state (random-number state and
  consumers) when generation finishes; it is small. `stream-drive` loads it
  instead of regenerating history (G7).
- **P1.4** Set `concurrency` on `generate-partition`, by default equal to the
  thread-pool size. Run `stream-drive` with concurrency above 1, or as one
  worker per stream (G4).
- **P1.5** Give each stream start its own job ID (for example
  `stream-${runId}-${startSeq}`), or remove completed stream jobs. Make `start`
  on a paused stream either fail with 409 or explicitly replace the sink (G8).
- **P1.6** Lifecycle (G13):
  - set the run to `running` before queueing jobs, in the same transaction that
    creates the partitions;
  - configure `attempts` with backoff on partition jobs;
  - add `POST /runs/:id/retry` for failed runs;
  - re-validate the spec on rollback, template clone and launch.

### P2. A real delivery stage and sink bindings

- **P2.1 Batch delivery job.** After generation, a `deliver` job reads
  `delivered/<sink>/` and publishes to the bound connection. This makes
  imperfections real for brokers (G1, G3). File sinks export `delivered/`, so
  file outputs also carry their configured imperfections.
- **P2.2 Bindings instead of inline sinks.** Run launch and `stream/start` take
  `bindings: [{ sink: "<spec sink name>", connection_id, topic? }]`.
  - The worker looks up the stored connection and decrypts its credentials (G3).
  - The binding is stored on the run, without secrets, so runs stay
    reproducible and auditable.
  - Remove the inline-sink request shape from the API and the MCP tool.
- **P2.3 Honour `batch_then_stream`.** When the run completes, start the stream
  automatically with the run's bindings and target TPS.
- **P2.4 Agent parity.** Add a `list_connections` MCP tool, and have
  `launch_run` and `start_stream` take bindings.

### P3. One event pipeline for history and live

- **P3.1 Generate one simulated day at a time.** Each day's events stream to the
  Parquet writers or the delivery stage instead of building up in arrays, so
  memory stays flat (G6).
- **P3.2 Plan fraud campaigns up front.** Pick actors and anchor times before the
  day loop, and inject each campaign's events on the right day. Spread
  account-takeover start times, and enforce dormancy by suppressing the victim's
  normal activity (G14).
- **P3.3 Turn imperfections into a per-event transformer.** It keeps a small
  amount of state (a delay queue for late events, a small buffer for
  reordering, and duplicate emission). Both batch delivery and the live stream
  use it, so live streams get labeled imperfections too (G1, G2).
- **P3.4 Run live mode on the same behaviour model.** Live events come from the
  same per-day logic (income, spending rhythm, seasonality, fraud) on a
  simulated clock that continues from where history ended. Map simulated time to
  wall-clock time using the target TPS, and stamp events with simulated time;
  the delivery timestamp may differ. This replaces `drawNextLiveEvent` (G2).
- **P3.5 Realism follow-ups (optional):** a daily activity curve, and a simple
  balance model so drains and refunds are limited by available funds.

### P4. Harden the stream delivery loop (G9)

- Publish with a bounded number of sends in flight. For Kafka, batch sends and
  count in-flight sends from delivery reports.
- Feed backpressure into the rate limiter. Report real sink lag (sends in flight
  plus queued).
- Webhooks: add a request timeout (`AbortSignal.timeout`), and move retries to a
  retry queue so one slow endpoint can't stall the stream.
- RabbitMQ: wait for broker confirms (in batches), and handle `drain`.
- Failed deliveries: count them in the metrics, and either send them to a
  dead-letter file or write them to the label channel as
  `corruption_type: "dropped"`, never as normal delivered events.
- Exports: merge labels into the main export by reading both sorted files in
  step instead of building an in-memory map, and keep all label fields (G15).
- Add a reference-scale batch benchmark: 200k consumers × 90 days with all
  typologies and imperfections (G16).

### UI-1. A Launch panel on the scenario page

A side drawer opened from the scenario page replaces the separate launch page
and the stream-console launcher. It asks three questions, each with a default:

```
┌ Launch "UPI India" (v3) ─────────────────────────────┐
│ Sinks in this spec        Deliver to                  │
│ events (kafka)        →   [local-kafka ▾] topic [upi.events] ✓ tested
│ archive (file)        →   Parquet download            │
│                           + New connection…           │
│ What to send  ○ History only (90 days → files)        │
│               ◉ History, then live stream             │
│ Rate          [ 50 TPS ]   ▸ Advanced: seed, labels…  │
│ Estimate      ~16.2M history events · ~4 min          │
│                                   [ Launch ▶ ]        │
└──────────────────────────────────────────────────────┘
```

- When a Kafka destination is chosen, "History, then live stream" is pre-selected.
- The last binding per scenario is remembered, so repeat launches take one click.
- The seed, label channel and scale override go under "Advanced".
- The estimate line needs a cheap event-count calculation from the spec, served
  by the API.

### UI-2. One run page with tabs

`/runs/:id` with tabs: **Progress → Live stream → Inspect → Ground truth →
Export**.

- The page moves to Live stream by itself when history finishes and streaming
  starts.
- Inspector, Ground truth and Stream stop being top-level sections with run
  pickers. All six surfaces required by FR-036 still exist, as tabs of a run.
- The sidebar becomes **Scenarios · Runs · Connections**.
- Runs are shown by scenario name, version and start time. The ID is secondary.
- Use router links throughout, not `<a href>`.

### UI-3. First run

- On an empty install, the home page shows one card: **"Stream a sample UPI world
  to Kafka"**. It clones the UPI template, binds `local-kafka`, and launches.
- That takes two clicks from a template to events on a topic, down from seven
  screens.

### CONN-1. Three layers, each with one owner

1. **Connection: where the broker is.** Shared across all scenarios, kept on the
   Connections page. Holds the address, security settings, credentials and a
   default topic.
2. **Spec: what kind of output.** Unchanged: a logical sink such as
   `{type: "kafka", name: "events"}`, with imperfections targeting `"events"`.
   No addresses or secrets in the spec, so specs stay shareable in git and the
   same scenario can target local Kafka or staging Kafka.
3. **Launch binding: which connection and topic this run uses.** Chosen in the
   Launch panel (UI-1) and stored on the run (P2.2).

### CONN-2. Connections page (sidebar → Connections)

Replaces today's "Sink connections" card and its raw JSON box. Each connection is
a card with a health indicator:

```
Connections                                   [+ Add connection]
┌───────────────────────────────┐ ┌───────────────────────────────┐
│ ● local-kafka         Kafka   │ │ ● staging-msk         Kafka   │
│ kafka:29092 · PLAINTEXT       │ │ b-1.msk…:9096 · SASL_SSL      │
│ default topic: txloom.events  │ │ default topic: upi.events     │
│ tested 2 min ago ✓            │ │ last test failed ✕ auth       │
│ [Test] [Edit] [⋯]             │ │ [Test] [Edit] [⋯]             │
└───────────────────────────────┘ └───────────────────────────────┘
```

**Add connection** first asks for a type (Kafka / RabbitMQ / Webhook), then shows
a typed form:

```
New Kafka connection
  Name               [staging-msk        ]
  Bootstrap servers  [b-1.msk…:9096, b-2…]   ⓘ address as seen by the TxLoom worker
  Security           (PLAINTEXT) (SSL) (●SASL_SSL) (SASL_PLAINTEXT)
  SASL mechanism     [SCRAM-SHA-512 ▾]
  Username / Password[••••] [••••]           stored encrypted, never shown again
  CA certificate     [Upload .pem] (optional)
  Default topic      [upi.events         ]
                     [Test connection]  ✓ connected · topic exists · 6 partitions
                                         [Cancel] [Save]
```

- Fields appear only when they apply; the SASL fields show only for SASL
  protocols.
- **Test works before Save**, so a broken config is never stored. The test
  fetches cluster metadata and reports whether the topic exists or would be
  auto-created.
- If the address contains `localhost`, a warning explains that inside Docker you
  should use `kafka:29092`.
- The Kafka sink needs matching options: security protocol, SASL mechanism
  (including SCRAM) and CA certificate (fixes the forced SSL + PLAIN in
  [producer.ts:48-57](../packages/sinks/src/kafka/producer.ts#L48-L57)).
- RabbitMQ and webhook connections get the same typed-form treatment.

### CONN-3. Inline, from the Launch panel

- The destination dropdown lists saved connections, plus a **"+ New Kafka
  connection…"** item at the bottom.
- That item opens the same form as CONN-2 in a drawer over the Launch panel.
  Saving selects the new connection and keeps everything else already filled
  in.
- The topic field sits next to the dropdown, pre-filled from the connection's
  default and editable per run. One connection can serve many topics without
  being duplicated.

### CONN-4. Read-only on the run page

- The Live stream tab shows the binding as a chip, `→ local-kafka / upi.events`.
- **Change** is enabled only while the stream is stopped.
- No address fields appear here, so every stream start uses the same configured
  broker.

### CONN-5. Zero-setup local Kafka

- When the `demo-brokers` compose profile is running, the API seeds a
  `local-kafka` connection (`kafka:29092`, topic `txloom.events`) on boot.
- The Connections page's empty state and the Launch dropdown both offer
  "Local Kafka detected at kafka:29092 — [Add it]" if it isn't registered yet.
- Optional: `TXLOOM_CONNECTIONS_*` environment variables pre-register
  connections for CI and headless setups. This stays optional, so it respects
  the "no required config-file editing" principle.

### Removals

- The stream console's inline sink form
  ([stream-launcher.tsx](../apps/web/src/surfaces/stream-console/stream-launcher.tsx)),
  including its e2e-test defaults.
- The raw JSON config box in
  [sink-management.tsx:157-165](../apps/web/src/surfaces/settings/sink-management.tsx#L157-L165).
- The inline `sink` shape on `POST /runs/:id/stream/start` and on the MCP stream
  tool. Bindings replace it.

---

## 6. Sequencing, tradeoffs, and open questions

### Suggested order

| Step | Contents | Why this order |
|---|---|---|
| 1 | P0, plus P1.3–P1.6 | Doesn't change output; fixes the high-severity scale and correctness issues |
| 2 | P2 and CONN-1, CONN-2, CONN-5 | Makes Kafka publishing configurable and authenticated; unblocks the UI |
| 3 | UI-1, UI-2, UI-3, CONN-3, CONN-4 | Builds on the bindings API |
| 4 | P1.1, P1.2 | Output-changing; safe once engine versioning exists |
| 5 | P3 | Largest change: rewrites generation into one pipeline |
| 6 | P4 | Can run in parallel with steps 3–5 |

### Tradeoffs

- **Linking sinks at launch vs putting addresses in the spec.** Linking adds one
  launch step, and remembering the last choice mostly removes it. Putting
  addresses in the spec would be simpler for a single user but mixes
  infrastructure details and secrets into a versioned, shareable file.
- **Run tabs vs top-level sections.** FR-036 lists six surfaces, and this keeps
  all six as tabs. The e2e UI flows (`apps/e2e/src/ui.ts` and its
  `data-testid`s) will need updating. Keeping the old routes as redirects limits
  that breakage.
- **Output-changing fixes.** P1.1, P1.2 and P3 change what a given seed produces.
  With P0 in place, older runs stay explainable but can't be regenerated
  identically on a newer engine.

### Open questions

1. Should the history phase also be published to Kafka (as a fast replay before
   live), or only written to files?
2. In live mode, should simulated time run in step with wall-clock time, or
   faster or slower, with TPS as the only control?
3. For failed deliveries, a dead-letter file or a `dropped` label, or both?
4. Is a simple balance model (P3.5) in scope for v1, or a later realism release?
5. Should `TXLOOM_CONNECTIONS_*` environment variables be supported in v1?

---

## 7. Next step

Build a **clickable UI prototype** of the proposed flow before changing product
code. It should cover:

- the scenario page with the Launch panel (UI-1), including linking a sink to a
  connection and "+ New connection" (CONN-3);
- the Connections page and the typed Kafka form with Test-before-Save (CONN-2),
  and the local-Kafka empty state (CONN-5);
- the run page tabs, with the Live stream tab and its read-only binding chip
  (UI-2, CONN-4);
- the first-run card (UI-3).

The prototype should use mocked data only, so the flow can be judged and revised
before the API work in P2.
