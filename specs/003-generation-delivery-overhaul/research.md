# Research: Generation-to-Delivery Overhaul

**Date**: 2026-10-10 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

**Sources.** Every decision below was checked against the code at commit `9882a84`, and, for library behaviour,
against current documentation:

- BullMQ docs (bullmq.io, via Context7): duplicate `jobId`s are not added; `concurrency`;
  `attempts` with exponential `backoff`; `removeOnComplete`/`removeOnFail`.
- Confluent `@confluentinc/kafka-javascript` docs (via Context7): librdkafka properties such as
  `security.protocol`, `sasl.mechanisms`, `sasl.username`/`sasl.password` and the SSL CA settings
  are given **outside** the `kafkaJS` block; an `AdminClient` can be created from an existing
  producer.
- `@dsnp/parquetjs` 1.8.8, read directly from the installed type definitions because it has no
  Context7 index: `ParquetWriter.openFile` / `openStream`, then incremental `appendRow` and
  `setRowGroupSize`.

There were no open `NEEDS CLARIFICATION` items in Technical Context. The spec's single
clarification (FR-021) was already resolved as option C.

---

## R1. Engine versioning (FR-001–FR-004, FR-006)

**Decision**:
- Add `ENGINE_VERSION`, a positive integer, to `packages/engine/src/version.ts`. Bump it only
  when an output-affecting change lands.
- The golden-master suite asserts that `ENGINE_VERSION` equals the version recorded next to
  the committed reference outputs. Changing output without bumping the version, or the
  reverse, fails CI.
- `runs` gains `engine_version` and `partition_count`, both written at launch.
- Existing rows are backfilled: `engine_version = 1`, and `partition_count = COUNT(*)` from
  `run_partitions`.
- **One bump per output-changing PR.** Every pull request that changes what a seed and spec
  produce bumps `ENGINE_VERSION` by one, re-baselines the golden master and adds a
  CHANGELOG entry in that same PR. The constitution's Determinism gate then passes PR by
  PR, and `main` stays releasable. In this feature the bumps are: seeds and named streams
  (US4), the per-day simulator (US3), the transformer and wire format (US2), live
  generation (US6), and realism (US9). Users see only the released number.

**Mismatch policy.** The engine carries one implementation; it does not keep old versions
side by side.

- **Regenerate** a run whose `engine_version` differs from the running one: return
  `409 engine_version_mismatch` with both versions in the message. The request may be retried
  with `accept_engine_change: true`; the new run then records the new version and links to
  its source run.
- **Stream start**, or **retry** of an incomplete run, on a mismatched version: refuse with
  `409 engine_version_mismatch`. Neither can be "accepted", because the saved world
  checkpoints and the partitions already on disk came from the old engine and mixing versions
  would silently corrupt continuity (spec edge case). The message points to Regenerate.
- **Worker side.** Every `generate-partition` and `stream-drive` job payload carries
  `engineVersion`. A worker running a different version fails the job with an
  `UnrecoverableError`, so BullMQ does not retry it, and the run shows the reason.

**Rationale**:
- An integer is unambiguous and cheap to compare.
- Tying it to the golden master makes the constitution's Determinism gate enforce the bump
  mechanically.
- Refusing cross-version continuation is the only option that never lies about
  reproducibility.

**Alternatives considered**:
- Package semver: it changes for reasons unrelated to output.
- Hashing the engine source: it changes on refactors that don't affect output.
- Keeping old engine versions loadable: far too costly for a single-maintainer open-source
  project.
- A single bump on a long-lived `engine-v2` branch: it holds about 90 tasks back from `main`,
  so the eventual merge is risky.
- Re-baselining inside an "open" version across several merges: forbidden by the
  Determinism gate, because golden-master output would change without a declared bump.

## R2. Seeds: full 64-bit, exact, no aliasing (FR-005)

**Decision**:
- **Range.** Seeds are unsigned 64-bit integers, `0 … 2^64−1`, which matches the existing
  `runs.seed BIGINT UNSIGNED` column.
- **Transport.** The API accepts `seed` as a decimal **string**. For backward compatibility
  it also accepts a JSON integer that is a safe integer (≤ 2^53−1). Other numbers are rejected
  with `400 invalid_seed`, and the message states the range.
- **Responses** return `seed` as a string.
- **Expansion.** `createRng(seed)` expands all 64 bits into xoroshiro128+'s 128-bit state with
  SplitMix64 and builds the generator with `xoroshiro128plus.fromState`.
- **The spec's own `seed` field.** It is required by `packages/spec/src/schema.json` but was
  ignored at launch; a random seed was drawn instead.
  - Launch precedence becomes: request `seed`, then `spec.seed`, then never random. A spec
    always carries a seed, so "same spec → same data" holds by default.
  - The JSON Schema bounds `spec.seed` to `0 … 2^53−1`, so a hand-edited or agent-written
    spec can't lose precision. A semantic invariant reports a located error
    (`/seed`, `seed-out-of-range`) with the remedy "pass larger seeds as the launch `seed`
    string".
  - Seeds above 2^53 are supplied only through the launch request's string `seed`.
  - This changes default launch behaviour (from random to `spec.seed`), so it is recorded
    in the CHANGELOG.

**Rationale**:
- SplitMix64 is the reference seeding procedure for the xoroshiro family. It makes distinct
  64-bit seeds give distinct states, which removes the 32-bit fold behind G10.
- Strings remove the JSON-number precision loss above 2^53.
- This is output-changing, so it ships with an engine-version bump (R1).

**Alternatives considered**:
- Rejecting seeds above 32 bits: simpler, but it shrinks the seed space and breaks existing
  large seeds.
- Accepting `number` only: loses precision.

## R3. Cheap named RNG streams; merchant pool rebuilt on the worker (G11, FR-036)

**Decision**:
- `deriveNamedRng(seed, name)` no longer walks a million `jump()` steps. It hashes
  `(seed, name)` into a fresh 64-bit seed (SplitMix64 over the seed, mixed with FNV-1a-64 of
  the name) and seeds a new generator from that, as in R2.
- `derivePartitionRng` keeps `jump()`: for partition *n* it costs *n* jumps, about 10 at the
  reference scale.
- The merchant pool is **removed from every job payload**. Each worker process builds it
  lazily per `(runId, engineVersion)` and keeps it in a small LRU cache (8 entries), so it is
  built once per process per run.
- The API never builds the merchant pool.

**Rationale**:
- Measured today: 670 ms of synchronous CPU on the API event loop for every launch, resume
  and stream start, plus the merchant list duplicated into Redis for every partition job.
- Hash-seeding is O(1).
- Stream independence holds because SplitMix64 outputs are well distributed and the named
  streams are few.

**Alternatives considered**:
- Precomputing jump polynomials: complex, and still per-call work.
- Caching the pool in Redis: still serialized into the payload path.

## R4. Parallel partitions inside a worker process (G4, FR-033)

**Decision**:
- Set the BullMQ `generate-partition` Worker's `concurrency` equal to the Piscina pool's
  `maxThreads`.
- The default is `min(availableParallelism() − 1, floor(0.6 × totalmem / 1 GiB))`, with a
  minimum of 1. It can be overridden with the existing `TXLOOM_MAX_WORKER_THREADS`.
- The memory term enforces the per-thread budget from SC-007, so that N concurrent partitions
  never exceed about 60% of RAM.

**Rationale**: The Piscina pool exists but sits idle today because the BullMQ default
concurrency is 1. The BullMQ docs confirm that `concurrency` is a per-Worker option.

**Alternatives considered**: Running multiple worker containers would contradict the
single-command distribution model. They remain a valid scale-out path and need no code
changes.

## R5. Streams: one session per start, isolated execution (G4, G8, FR-026, FR-027, FR-029)

**Decision**:
- **Session table.** Add `stream_sessions` (one row per start).
- **Job IDs.** A stream job's ID is `stream-<runId>-<seq>`, and jobs set
  `removeOnComplete: {age: 86400}` and `removeOnFail: {age: 604800}`. The BullMQ docs confirm
  that a duplicate ID is silently dropped, which is the G8 bug.
- **Concurrency.** The `stream-drive` Worker gets its own `concurrency`, set by
  `TXLOOM_MAX_STREAMS` (default 4).
- **Restart from stop.** This creates session `seq + 1`. It resumes the world from the
  previous session's final checkpoint (R7), so simulated time continues and is never reset.
- **Start while paused.** This returns `409 stream_paused`, with the remedy in the message.
- **Change destination.** `PUT /runs/:id/stream/destinations` (which changes only the destinations future sessions use) is allowed only when no session is
  `streaming`, `paused` or `error`.
- **CPU isolation.** Each active session runs a dedicated **live-world worker thread** (a
  `worker_threads` Worker, not Piscina, because it is long-lived and stateful). That thread
  holds every partition's world state, generates simulated days, k-way merges the partitions
  by simulated time, applies the per-sink imperfection transformer (R9), and fills a bounded
  ring buffer, by default 2 simulated hours or at least 50k events. The BullMQ job's main
  thread only paces, publishes and records metrics.
- **Backpressure** between the two threads flows through `MessagePort` request/response:
  the main thread asks for more when the buffer is below its low-water mark.

**Rationale**:
- Generating one simulated day of a reference partition (about 55k events) takes roughly
  0.4 s of CPU. Doing that on the job's event loop would stall pacing and other streams.
  Today's design blocks the loop far longer, because it regenerates all of history (G7).
- A dedicated thread keeps the main thread's work small and keeps the BullMQ lock renewals
  timely.

**Alternatives considered**:
- Piscina tasks per simulated day: world state would cross the thread boundary every day,
  copying several MB each time.
- A separate "streamer" container: it would add a service to compose (Complexity Tracking),
  with no benefit at this scale.

## R6. One per-day generation pipeline for history and live (G2, G5, G6, G14, FR-034, FR-035, FR-041–FR-043)

**Decision**: Replace the build-all-then-sort `generatePartition` with a stateful **day
simulator**:

```
initPartitionWorld(spec, seed, partitionNo, partitionCount, merchants) → PartitionWorld
simulateDay(world, dayIndex) → { events: TruthEvent[] (sorted), labels: LabelRecord[] (aligned) }
checkpointWorld(world) → WorldCheckpoint;  restoreWorld(spec, ckpt, merchants) → PartitionWorld
```

History is days `0 … clock.days−1`. Live is days `clock.days, clock.days+1, …`, generated by
the same function from the restored checkpoint. Within the day loop:

- **Daily activity curve.** Event times inside a day are drawn from a built-in hour-of-day
  curve: a piecewise-constant 24-bin weight table that peaks in the morning and evening and
  dips at night. The draw takes one uniform value plus one alias-table lookup. There is no
  spec change. A per-spec override is a later candidate.
- **Fraud planned up front, per day.** At the start of each day, the planner uses the target
  rate to draw how many campaigns start that day for each typology. It does this from the
  day's *expected* legitimate volume, a closed-form function of the population, the weekday or
  weekend rhythm and the seasonality multiplier, so the planner never needs the day's actual
  events first. Each campaign's events are scheduled into `world.pendingFraud`, a min-heap
  keyed by simulated time, and drained into the day they fall on. This lets a campaign that
  starts on day 89 continue into live day 90 and beyond.
- **Account takeover.** The anchor day is drawn uniformly from the remaining horizon. In live
  mode the horizon is open-ended and is drawn per day. The victim is marked
  `dormantUntil = anchor`, and the day loop **skips normal spending and income** for dormant
  consumers (spec US9-2). The drain happens after dormancy ends.
- **Refund abuse.** Each consumer keeps a ring buffer of their last 16 purchases in
  `world.recentPurchases` (a `Map<consumerIndex, ring>` holding only consumers who have
  purchased). A refund attempt picks from that ring in O(1). This replaces the quadratic
  `legitEvents.filter` (G5).
- **Realism stats** are accumulated incrementally per day, using the existing
  `realism/aggregators` sketches fed day by day instead of from the full arrays.

The history job (`partition-worker.ts`) loops over days, writes each day to incremental Parquet
writers (R8), and calls `checkpointWorld` after the last day.

**Rationale**:
- One function gives literal "same world continued" semantics for live (G2).
- Memory is bounded by one day plus pending-campaign state (G6).
- Planning campaigns per day keeps the fraud rate on target in open-ended live mode.
- Target-rate accuracy is still verified by seeded property tests within tolerance
  (constitution III).

**Alternatives considered**:
- Keeping batch generation and writing a separate live generator: this is today's design,
  and it is the cause of G2.
- Generating per consumer instead of per day: memory stays flat, but time order breaks and a
  global merge is needed.

## R7. World checkpoints (G7, FR-028)

**Decision**:
- At the end of history, each partition writes
  `runs/<runId>/checkpoints/part-<n>.v<engineVersion>.json.gz`. The file holds:
  - RNG state (4 × int32);
  - `nextDayIndex`;
  - consumer state: the static archetype index and name, plus mutable `dormantUntil` and a
    compromised flag;
  - the pending-fraud heap;
  - `recentPurchases`;
  - imperfection transformer state per sink (R9);
  - its SHA-256.
- `run_partitions.rng_checkpoint` stores `{path, sha256, next_day_index}`. The column keeps
  its name, which avoids a column rename in MySQL.
- **Live sessions** checkpoint every simulated-day boundary to
  `streams/<sessionId>/part-<n>.day-<d>.json.gz`. The last two are kept.
- **Delivered counter.** The session row records `delivered_since_checkpoint` once a second.

**Crash resume.** After a worker restart, BullMQ's stalled-job check hands the session's
active `stream-drive` job back to a worker. The Worker sets `maxStalledCount: 10` and
`stalledInterval: 15000`, so a restart is not mistaken for a poisoned job. The resumed job
keeps the same session (`seq` unchanged), restores from the latest day checkpoint,
regenerates deterministically, and **skips** the first `delivered_since_checkpoint`
deliveries. Boot reconciliation moves a stream to `stopped` only when its session's job is
*missing* from BullMQ, which happens only if Redis lost it.
Re-publishing is limited to the sends that were in flight at the crash. That is at-least-once
behaviour, and because those repeats keep their original `delivery_id`, no imperfection label
is minted for them (spec edge case).

**Size estimate**: 20k consumers × about 120 B, plus heaps, is about 3 MB raw and under 1 MB
gzipped per partition.

**Rationale**: The column was reserved for exactly this but is always written as `null` today.
Files sit next to the other run outputs on the shared data volume, and gzipped JSON keeps
the format inspectable.

**Alternatives considered**:
- MySQL JSON blobs: multi-MB rows, plus binlog churn.
- Re-deriving the state on demand: that is today's G7.

## R8. Streaming Parquet writes and file layout (G6, G15, FR-020, FR-025)

**Decision**:
- Add `ParquetStreamWriter` (`open → append(row) → close`) to `packages/sinks/src/file/`.
  It wraps `ParquetWriter.openFile` with `setRowGroupSize(10_000)`, so at most one row group
  is buffered.
- Per-partition run layout:

```
runs/<id>/truth/part-<n>.parquet                    # truth events, simulated-time order
runs/<id>/labels/part-<n>.parquet                   # one fraud label per truth row, SAME ORDER (aligned)
runs/<id>/delivered/<sink>/part-<n>.parquet         # delivered copies in DELIVERY order
runs/<id>/delivered/<sink>/labels-part-<n>.parquet  # fraud label per delivered row, SAME ORDER (aligned)
runs/<id>/corruptions/<sink>/part-<n>.parquet       # one row per injected corruption (dup/late/ooo/skew)
runs/<id>/deliveries/<sink>/dropped-<k>.parquet     # delivery_outcome = dropped, from replay/live failures
runs/<id>/checkpoints/part-<n>.v<ver>.json.gz       # R7
```

- **Exports with `include_labels`** zip the data file with its *aligned* label file in
  lockstep. This takes constant memory, keeps every label field (G15), and needs no
  `Map<event_id, label>`.
- **Answer key** = `labels/` + `corruptions/<sink>/` + `deliveries/<sink>/dropped-*`.
- The world inspector's imperfection audit and the ground-truth routes read the new
  `labels/` and `corruptions/` paths. Their contract tests are updated.

**Rationale**:
- Positional alignment is free, because both files are written in the same pass.
- A sort-merge join by `event_id` would need an external sort, because deterministic ULIDs
  aren't strictly ordered.

**Alternatives considered**:
- Embedding label columns in the delivered files: that leaks the answer key into the data
  (FR-021 v1).
- An external merge sort: unnecessary given alignment.

## R9. Imperfections as a per-event transformer (G1, FR-020, FR-044)

**Decision**: Replace `applyImperfections(allEvents)` with a stateful
`ImperfectionTransformer` per sink:

```
push(truthEvent, fraudLabel) → void         // enqueue by delivery time
drainUntil(simTimeMs) → Delivered[]          // emit everything due by simTimeMs, in delivery order
flush() → Delivered[]                        // end of history / stop
```

- **Late arrival.** The event goes into a min-heap keyed by `ts + delay` and is emitted when
  the simulated clock passes that time. Its payload `ts` stays the event time (see R14).
  Lateness is therefore observable as delivery position, not as an altered timestamp.
- **Clock skew.** The source's offset is added to the payload `ts`. Delivery order is
  unchanged.
- **Out-of-order.** A one-slot hold buffer swaps the flagged event with its successor.
- **Duplicates.** Extra copies are emitted immediately after the primary, each with a fresh
  `delivery_id`.
- **Labels.** Every corruption emits a corruption label as it happens.
- **Randomness.** Each transformer gets a dedicated RNG,
  `deriveNamedRng(seed, "imperfections:<sink>:p<n>")`. It is independent of the generation
  stream, so adding a sink never perturbs truth output.
- **Where it runs.** Batch runs it in the partition worker, writing `delivered/<sink>/`. Live
  runs it inside the live-world thread (R5).
- **History-to-live boundary.** The batch transformer is **flushed** at the end of history.
  Its pending late events are emitted at the end of the history delivered stream. The live
  transformer starts empty.

**Rationale**:
- One implementation for batch and live (review P3.3).
- The memory bound is the delay heap, which holds events whose delay exceeds the elapsed
  time, so at most about rate × max delay.

**Alternatives considered**: Keeping the batch-only `applyImperfections` and adding a separate
live path would mean two implementations that diverge.

## R10. Connections, destinations and the end of inline sinks (G3, FR-007–FR-019)

**Decision**:
- **Rename.** Rename the table `sink_connections` → `connections`, and drop the `file` type,
  since files need no connection.
- **API path.** `/sinks` is replaced by `/connections`. The old path returns
  `410 gone` with a pointer to the new one for one minor release.
- **Typed config.** Each connection type has a typed `config` validated by Ajv, defined in
  `contracts/api.md`:
  - **Kafka**:
    - `bootstrap_servers[]`;
    - `security_protocol` (`PLAINTEXT|SSL|SASL_PLAINTEXT|SASL_SSL`);
    - `sasl_mechanism` (`PLAIN|SCRAM-SHA-256|SCRAM-SHA-512`), required iff the protocol
      is `SASL_*`;
    - `ca_pem?` (stored in config, because it is public material);
    - `default_topic`.
  - **Secrets** (`username`, `password`) are encrypted with the existing AES-256-GCM envelope.
  - **RabbitMQ**: `{host, port, vhost, tls, exchange, exchange_type, default_routing_key}`,
    with the username and password as secrets.
  - **Webhook**: `{url, timeout_ms, max_attempts}`. Headers are treated as secret, because
    they often carry tokens.
- **Kafka client mapping.** The sink maps the connection onto **librdkafka top-level
  properties**: `bootstrap.servers`, `security.protocol`, `sasl.mechanisms`, `sasl.username`,
  `sasl.password` and `ssl.ca.pem`. These sit outside the `kafkaJS` block, per the Confluent
  migration guide, which says SSL and CA settings must be outside `kafkaJS`. This removes the
  forced SSL + PLAIN.
- **Destinations ("destinations").** Launch and `stream/start` take
  `destinations: [{sink, connection_id, topic?, routing_key?, label_topic?}]`.
  - Each run stores them in `run_destinations`: an **immutable launch-time record** with
    connection-name and type snapshots and no secrets. This matches the spec's edge case:
    completed runs keep their destinations as they were at launch.
  - The destinations used by *future* stream sessions live in `streams.destinations`. It is
    initialized from the launch record and changed with `PUT /runs/:id/stream/destinations`,
    only while no session is active (FR-048). Each session and each history replay
    snapshots what it actually used (`stream_sessions.destinations_snapshot`,
    `run_deliveries.destination_snapshot`).
  - `connection_id` uses `ON DELETE SET NULL`, so deleting a connection leaves an auditable
    snapshot, and the next stream start returns `409 destination_connection_missing` with a
    prompt to choose a new destination.
- **Remembered defaults.** `scenario_destination_defaults` holds the last destinations per
  scenario.
- **Removed inputs.** The inline `sink` body is removed from `stream/start`, the CLI and MCP.
  `sink_connection_ids` is removed from launch.
- **Validation.** Every non-file `output.sinks[]` entry needs a destination. A missing one returns
  `400 sink_without_destination`, with `details.sink` naming it.

**Rationale**:
- These are the three layers from review CONN-1. Specs stay free of addresses and secrets
  (constitution: spec as source of truth, shareable in git).
- Snapshots keep runs auditable after a connection is edited or deleted.

**Alternatives considered**: Putting addresses in the spec mixes infrastructure and secrets
into a versioned, shareable file (review §6 tradeoff).

## R11. Testing a connection from where publishing happens (FR-010, FR-012)

**Decision**:
- `POST /connections/test` takes an unsaved candidate; `POST /connections/:id/test` tests a
  saved one.
- Both enqueue a short `connection-test` BullMQ job and wait for it with
  `job.waitUntilFinished(queueEvents, 15_000)`. The **worker** runs the probe, because the
  worker is what publishes. This catches the `localhost` vs `kafka:29092` trap.
- **Secrets in the queue.** Credentials in the job payload are sealed with the instance key
  (`encryptSecret`). Both containers mount the same data volume and read the same
  `keys/instance.key`, so plaintext never touches Redis.
- **Staged results.** The probe returns
  `{ok, stage: "resolve"|"connect"|"tls"|"auth"|"topic"|"done", detail, topic?: {exists, partitions, auto_create_allowed, retention_ms}}`.
- **Kafka probe.** It uses `AdminClient.createFrom(producer)` to fetch metadata for the topic
  and describe its `retention.ms` and the broker's `auto.create.topics.enable`.
  - **Missing topic, auto-create forbidden**: `ok: false`, `stage: "topic"`, and a detail
    naming the topic. Saving is still allowed; the saved connection carries the warning
    `topic_missing`, because the topic may be created later (spec edge case).
  - **Retention**: `retention_ms` is stored in `last_test_result`. When "Replay history to
    broker" is on and the history window is longer than the destination topic's known
    retention, the Launch drawer shows a `retention_shorter_than_history` warning. The
    launch API returns the same warning in `warnings[]`. Neither blocks the launch.
- **No worker.** If no worker answers within 15 s, the response is
  `503 worker_unavailable`, with the remedy "start the worker container".
- **Localhost warning.** This one is computed in the UI and in API validation. A host of
  `localhost` or `127.0.0.1` adds `warnings: [{code: "localhost_address", …}]`.

**Alternatives considered**: Probing from the API process gives misleading results whenever
the worker's network differs (review §4).

## R12. Delivery loop hardening (G9, FR-023, FR-024, FR-030–FR-032)

**Decision**: Add a shared `DeliveryPump` in `packages/sinks/src/pump.ts`, used by both
history replay and live streams:

- **Window.** A bounded in-flight window: by default 1,000 for Kafka, 256 for RabbitMQ and
  32 for webhooks.
  - The pump calls `sink.publish()` without awaiting each call serially.
  - Each promise resolves when the broker **acknowledges** the message: a Kafka delivery
    report, a RabbitMQ publisher confirm, or a webhook 2xx.
  - When the window is full, the pump waits for a free slot.
- **Kafka batching.** The Kafka sink batches through the producer's internal queue
  (`linger.ms=5`, `batch.num.messages=10000`). Each `send()` promise is one delivery report.
- **RabbitMQ.** It uses the confirm channel's per-publish callback, and when `publish()`
  returns `false` it waits for `'drain'`.
- **Webhooks.**
  - Every request is bounded by `AbortSignal.timeout(timeout_ms)`, default 5 s.
  - Failures go into a **retry heap** keyed by due time, with exponential backoff and jitter,
    and are re-attempted alongside new events.
  - When `max_attempts` is exhausted, the event becomes `dropped`.
- **Rate control and lag.**
  - The token bucket's effective rate is `min(target, aimd)`: AIMD halves on backpressure,
    meaning the window is full or the sink signals it, and adds 5% of the target each second
    otherwise.
  - Reported `sink_lag` = in-flight + retry heap + ring-buffer backlog that is due.
- **Failures.**
  - A failed delivery is counted in `failed`, and a label with `delivery_outcome:
    "dropped"` (and `corruption_type: null`) is appended to
    `deliveries/<sink>/dropped-*.parquet`. In live mode it is also sent on the label
    channel. Keeping it out of `corruption_type` means that enum still lists exactly the four
    injectable imperfections (constitution scope discipline).
  - **Breaker**: if the failure ratio stays above 50% over a rolling 30 s window, with at
    least 100 completions in that window (the numbers FR-032 now states), the session
    moves to `error`, stops publishing, and surfaces `last_error` plus the counts. The user can
    stop it, fix the problem, then start a new session.
- **History replay** uses the same pump with no token bucket. It publishes as fast as the
  window drains (FR-021).

**Sink interface change**:
- `publish()` must resolve on the broker's acknowledgement and must not retry internally.
  Retries are now the pump's job.
- `testConnection()` becomes `probe()` and returns staged results.
- This changes the documented plugin contract (FR-027), so the interface version moves from
  1 to 2 (`contracts/sink-plugin.md`).

**Rationale**: This removes all six G9 defects with one mechanism.

**Alternatives considered**: Patching each sink separately: that would leave serial
publishing in the driver loop, which is the root cause.

## R13. Run lifecycle and phases (G13, FR-021, FR-022, FR-037–FR-039)

**Decision**:
- **Atomic launch.** Inside one Knex transaction, insert the run as `running` (with
  `started_at`), its partitions and its destinations. Enqueue only after commit. If the enqueue
  fails, mark the run `failed` with the error. This removes the race where a run stays
  `queued` (G13).
- **Retries.** Partition jobs use `attempts: 3` with `backoff: {type: "exponential", delay:
  5000}`, per the BullMQ docs. A partition is marked `failed`, and the run with it, only when
  `job.attemptsMade >= job.opts.attempts` or the error is an `UnrecoverableError`, such as an
  engine-version mismatch or an invalid spec.
- **User retry.** `POST /runs/:id/retry` is allowed only when the run is `failed`. It
  re-enqueues every partition that isn't `done`, with a fresh `jobId` suffix (`-r<k>`), and
  checks the engine version (R1).
- **Phases.** `runs.mode` becomes `history_only | history_then_live`. The old `batch` and
  `batch_then_stream` values are migrated across. A new `runs.replay_history BOOLEAN` is
  added.
  - When generation completes, `report-build` is enqueued as today.
  - If `replay_history` is on, one `deliver` job is enqueued per bound broker or webhook sink,
    tracked in `run_deliveries`: pending → running → done | failed | skipped, with a cursor of
    `{partition, row}` checkpointed every 10k rows.
  - When every delivery is `done` or `skipped` and the mode is `history_then_live`, the worker
    auto-creates stream session 1 with the run's destinations and target rate (FR-022).
  - A failed delivery blocks the automatic live start. `POST
    /runs/:id/deliveries/:sink/retry` continues from the cursor; `…/skip` marks it skipped.
- **Re-validation.** `validateSpec` runs on rollback, template clone and launch. Failure
  returns `400 spec_invalid` with the located `details.violations[]`, the existing envelope.

**Rationale**:
- This is the minimal state added to make phases explicit and resumable.
- The `runs.status` enum keeps meaning *generation* status; replay and live have their own
  tables, so existing consumers of `status` don't break.

## R14. Wire format for delivered events (FR-042, compatibility with `analytics-flink/`)

**Decision**: The delivered payload, used for both Kafka and RabbitMQ bodies and webhook
POSTs, is defined in `contracts/wire-format.md`:

- `ts` = the **event time as reported by the source**: truth `ts` plus the clock-skew offset
  when skewed. It is simulated time and is never wall-clock.
- **New** `delivered_at` = the simulated delivery time, which is `ts` plus the late-arrival
  delay when late. **New** `sent_at` = the wall-clock publish time (live only; `null` in
  replay).
- `delivery_id`, `event_id` and every existing truth field are unchanged.
- `partition_no` stays in the payload. `analytics-flink` reads it, and it has never been
  part of the answer key.

**Compatibility note**:
- Today `ts` is overwritten with *delivered* time (truth + delay + skew).
- `analytics-flink/jobs/.../Event.java` documents "`ts` is delivery time" and uses the Kafka
  record timestamp to detect skew.
- Under the new engine version, late arrival becomes observable the way it is in real feeds: an old `ts`
  arriving late. `delivered_at` carries the arrival time.
- **The Flink labs' `CleanAndOrderJob` must be updated to read `delivered_at`.** This is
  listed as a task, and the change is recorded in the changelog with the US2 engine-version
  bump.

**Rationale**: A late-arrival imperfection whose arrival time is stamped into `ts` can't be
observed by any consumer, which defeats the imperfection.

## R15. Local Kafka auto-registration and environment-defined connections (FR-013, FR-014)

**Decision**:
- **Boot-time seeding.** On boot, the API probes the demo broker: it resolves `kafka` and
  connects over TCP to port 29092, with a 1 s timeout. If the broker is reachable and the
  `settings` key `local_kafka_seeded` is unset, the API creates the `local-kafka` connection
  (`kafka:29092`, `PLAINTEXT`, default topic `txloom.events`) and sets the flag. Because the
  flag stays set, deleting the connection is respected on the next boot.
- **Detection prompt.** `GET /connections/suggestions` re-probes, and returns the suggestion
  when the broker is reachable and no connection points at it. This feeds the "Local Kafka
  detected — Add it" prompt.
- **Environment definitions.** `TXLOOM_CONNECTIONS_JSON`, an optional array in the same
  shape as `POST /connections`, is upserted by name at boot. Those rows are marked
  `managed_by = "env"` and are read-only in the UI. When the variable is absent nothing
  changes, so first use still needs no configuration editing (constitution IV).

## R16. Volume and duration estimate (FR-045, US5-7)

**Decision**:
- `estimateRun(spec, {replayHistory, partitionThroughput})` is a pure function in the engine.
  It sums, over the days, `consumers × E[daily tx | weekday/weekend] × seasonality`, plus the
  expected income credits, plus the fraud share. Duplicates multiply by `1 + rate`.
- Duration = `events / (throughput × min(partitions, threads))`. Throughput defaults to the
  value recorded by the latest reference benchmark (`settings.generation_throughput`, seeded
  at 150k events/s per thread from the review's measurement) and is refined by each completed
  run's own measured rate.
- It is exposed as `POST /spec/estimate`, which takes about 1 ms and never touches the
  generator.

## R17. UI restructure, prototype first (FR-045–FR-053, review §7)

**Decision**:
- **Prototype first.** Build the Launch panel, the Connections page, the run page tabs and the
  first-run card against the typed API client **first**, backed by a mock adapter in
  `apps/web/src/api/mock/` enabled with `VITE_TXLOOM_MOCK=1`. That build is the clickable
  prototype from review §7. Its findings can revise the UI contract
  (`contracts/ui-routes.md`) before the P2 APIs are frozen.
- **Component tests reuse the mock adapter**, so it is maintained test infrastructure, not
  dead code.
- **Routes.** React Router nested routes:
  - `/scenarios/:id` with the Launch drawer;
  - `/runs` and `/runs/:id/:tab` (`progress|live|inspect|truth|export`);
  - `/connections`.
- **Redirects.** `/stream/*`, `/inspector/*` and `/ground-truth/*` redirect with
  `<Navigate>`. `/settings` keeps global defaults and agent connection details, and links to
  Connections.
- **Links.** Every `<a href>` that points inside the app becomes a `<Link>`.
- **E2E suite.** The specs/002 suite's UI flows (`apps/e2e/src/ui.ts`) are updated. The
  `data-testid`s it uses are listed in `contracts/ui-routes.md` as a stable contract.

## R18. Reference-scale benchmark (FR-040, SC-006–SC-010)

**Decision**:
- `benchmarks/batch/bench-reference.ts` launches the reference spec through the **API**, so
  it runs through BullMQ and the workers exactly as users do. The spec is 200k consumers, 5k
  merchants, 90 days, all three typologies and all four imperfections.
- It records wall time, peak RSS per worker thread (sampled through
  `worker.resourceLimits` and `performance.eventLoopUtilization` plus a `process.memoryUsage`
  probe in each thread) and events per second. It writes `benchmarks/results/<date>.json`.
- **Smoke variant in CI** (20k consumers × 14 days): fails on a regression above 15% against
  the committed baseline.
- **Memory-flatness check**: 30 days vs 90 days at the same population, with the ≤ 10% growth
  from SC-007.
- **Refund-abuse scaling check**: populations of 2k and 4k, with the ≤ 2.5× growth from
  SC-008.
- **Kafka benchmark.** `benchmarks/kafka` is switched to drive a real stream session through
  the API at 1,000 events/s for 30 minutes (SC-010) with all typologies and imperfections on.
- **Reference hardware**: 8 vCPU and 16 GB RAM, Linux with Docker. The same machine class is
  used for the published numbers.

## R19. Exports run as a worker job (constitution V, FR-020, FR-025)

**Decision**:
- `POST /runs/:id/exports` validates the request (including the label-warning
  acknowledgement), writes a `queued` manifest, enqueues an `export-build` BullMQ job, and
  returns `202 {export_id, status: "queued"}`.
- The worker job `apps/worker/src/jobs/export-build.ts` does all the Parquet decoding and
  encoding: it selects the source (truth or a file sink, R8), merges the aligned label files
  when labels are included, writes the files, and moves the manifest through `running` to
  `completed` or `failed`.
- `GET /runs/:id/exports/:exportId` reports the status, and the download link appears once
  it is `completed`.
- The MCP tools `create_export` and `get_export` follow the same queued-then-poll model.
  The web export controls poll the status.

**Rationale**:
- Today exports decode and encode Parquet in the API process. That is CPU-bound work on the
  API event loop, which constitution V forbids, and it gets heavier with sink sources and
  label merging at reference scale (millions of rows).
- Moving it into a worker job keeps the API responsive (SC-014), reuses the worker's data
  volume, and needs no new service.

**Alternatives considered**:
- A Piscina pool inside the API container: it puts CPU-bound work back in the API process,
  and the API would need a second thread pool.
- Synchronous export behind a larger timeout: it still blocks the event loop.

