# Data Model: Generation-to-Delivery Overhaul

**Date**: 2026-10-10 | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

This document describes changes to the v1 model
([001 data-model](../001-synthetic-transaction-studio/data-model.md)) and the new entities.
MySQL tables are created through Knex migrations `010`–`014` in `apps/api/src/db/migrations/`, numbered in the order the tasks apply them.
Every migration is forward-only and backfills existing rows.

## 1. MySQL

### 1.1 `connections` (renamed from `sink_connections`; migration 011)

| Column                         | Type                                  | Notes                                                                                    |
| ------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`                           | CHAR(26) PK                           | ULID                                                                                     |
| `type`                         | ENUM(`kafka`,`rabbitmq`,`webhook`)    | `file` rows are deleted by the migration; files need no connection                       |
| `name`                         | VARCHAR(120) UNIQUE                   | `^[a-z0-9][a-z0-9-]{0,62}$`, the name shown in destination chips (`local-kafka`)         |
| `config`                       | JSON                                  | typed per `type` (see 1.1.1), with **no secrets**                                        |
| `credentials_enc`              | VARBINARY NULL                        | AES-256-GCM envelope of the secret JSON (1.1.2)                                          |
| `managed_by`                   | ENUM(`user`,`env`,`auto`) default `user` | `env` = `TXLOOM_CONNECTIONS_JSON` (read-only in the UI); `auto` = seeded `local-kafka` |
| `last_test_at`                 | TIMESTAMP NULL                        |                                                                                          |
| `last_test_ok`                 | BOOLEAN NULL                          |                                                                                          |
| `last_test_result`             | JSON NULL                             | `ProbeResult` (contracts/sink-plugin.md), with no secrets                                |
| `created_at`, `updated_at`     | TIMESTAMP                             |                                                                                          |

**Migration of old rows.** Each old `config` is mapped into the typed shape:

- **Kafka**: `{brokers, topic}` → `{bootstrap_servers, security_protocol, default_topic}`. The
  protocol is `SASL_SSL` + `PLAIN` if credentials exist, else `PLAINTEXT`, which matches what
  the old code actually did.
- **RabbitMQ**: the `url` is parsed into host, port, vhost and TLS, and its userinfo moves
  into the credentials.

A row that can't be mapped is kept with `last_test_ok = false`, and its `last_test_result`
records why.

#### 1.1.1 `config` by type

| Type       | Fields                                                                                                                                                                       | Validation                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `kafka`    | `bootstrap_servers: string[]` (`host:port`, ≥1), `security_protocol: PLAINTEXT\|SSL\|SASL_PLAINTEXT\|SASL_SSL`, `sasl_mechanism?: PLAIN\|SCRAM-SHA-256\|SCRAM-SHA-512`, `ca_pem?: string`, `default_topic: string`, `partition_key_field?: string` (default `consumer_id`) | `sasl_mechanism` required iff protocol is `SASL_*`, forbidden otherwise; `ca_pem` allowed only with `SSL`/`SASL_SSL` and must parse as PEM; topic matches `^[A-Za-z0-9._-]{1,249}$` |
| `rabbitmq` | `host`, `port` (default 5672/5671), `vhost` (default `/`), `tls: boolean`, `ca_pem?`, `exchange`, `exchange_type: direct\|topic\|fanout`, `default_routing_key`                   | `ca_pem` only when `tls`                                                                                          |
| `webhook`  | `url` (http/https), `timeout_ms` (default 5000, 100–60000), `max_attempts` (default 5, 1–10)                                                                                    |                                                                                                                  |

#### 1.1.2 Secret JSON (encrypted; never returned)

| Type       | Shape                                     |
| ---------- | ----------------------------------------- |
| `kafka`    | `{username, password}` (SASL_* only)      |
| `rabbitmq` | `{username, password}`                    |
| `webhook`  | `{headers: Record<string,string>}` (optional) |

Responses expose only `has_credentials: boolean`. On update, an omitted secret keeps the
stored one, and `null` clears it.

### 1.2 `runs` (altered; migration 010)

| Column            | Change                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `engine_version`  | **new** INT UNSIGNED NOT NULL. Backfilled to `1`.                                                                           |
| `partition_count` | **new** SMALLINT UNSIGNED NOT NULL. Backfilled as `COUNT(run_partitions)`.                                                  |
| `mode`            | ENUM changed to (`history_only`,`history_then_live`). Mapped from `batch` and `batch_then_stream`.                          |
| `replay_history`  | **new** BOOLEAN NOT NULL default false (FR-021)                                                                             |
| `target_tps`      | **new** INT UNSIGNED NULL. The live rate chosen at launch (the panel's "Rate").                                              |
| `label_channel`   | **new** BOOLEAN NOT NULL default false. Replaces `params.stream_label_channel`.                                            |
| `source_run_id`   | **new** CHAR(26) NULL. Set by regenerate; links to the original run.                                                        |
| `seed`            | Unchanged column (BIGINT UNSIGNED). The API now carries it as a decimal string.                                             |
| `params`          | Keeps only `{label_export, scale_override?}`. `sink_connection_ids` is dropped.                                            |

Launch is atomic: one transaction inserts the run as `running` with `started_at`, plus its
partitions and destinations, and jobs are enqueued after commit (research R13).

**Run status state machine.** The status still describes *generation* only.

```
running ──all partitions done──▶ completed
running ──partition exhausted retries / unrecoverable──▶ failed ──POST /retry──▶ running
running ──pause──▶ paused ──resume──▶ running
running|paused ──cancel──▶ cancelled
```

`queued` stays in the enum for old rows. New runs never enter it.

### 1.3 `run_partitions` (altered; migration 010)

| Column           | Change                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `rng_checkpoint` | Now written when generation finishes: `{path, sha256, next_day_index}` (WorldCheckpointRef) |
| `attempts`       | **new** TINYINT UNSIGNED default 0, copied from `job.attemptsMade` for display              |
| `last_error`     | **new** TEXT NULL                                                                          |

### 1.4 `run_destinations` (new; migration 012)

| Column            | Type                                                | Notes                                                       |
| ----------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `run_id`          | CHAR(26) FK → runs ON DELETE CASCADE                | PK part                                                     |
| `sink_name`       | VARCHAR(120)                                        | PK part. Must equal an `output.sinks[].name` of non-file type |
| `connection_id`   | CHAR(26) NULL FK → connections ON DELETE SET NULL   | null once the connection has been deleted                    |
| `connection_name` | VARCHAR(120)                                        | snapshot taken at launch                                     |
| `connection_type` | ENUM(`kafka`,`rabbitmq`,`webhook`)                  | snapshot; must equal the spec sink's `type`                  |
| `topic`           | VARCHAR(249) NULL                                   | Kafka; defaults to the connection's `default_topic`         |
| `routing_key`     | VARCHAR(255) NULL                                   | RabbitMQ; defaults to `default_routing_key`                  |
| `label_topic`     | VARCHAR(249) NULL                                   | Kafka/RabbitMQ label channel target (FR-030a)                |
| `created_at`      | TIMESTAMP                                           | rows are **immutable after launch**: the audit record of where the run was sent (spec edge case "keep the destination as at launch") |

### 1.5 `scenario_destination_defaults` (new; migration 012)

PK is (`scenario_id`, `sink_name`). The other columns are `connection_id` (FK, ON DELETE
CASCADE), `topic`, `routing_key`, `label_topic` and `updated_at`. The table is upserted on
every launch (FR-019). Rows whose `sink_name` no longer exists in the current spec are
ignored when the panel prefills; the spec edge case "renamed sink → unbound" covers this.

### 1.5a `scenario_launch_defaults` (new; migration 012)

One row per scenario, upserted on every launch so the Launch panel can prefill (FR-019,
SC-002):

| Column           | Type                                          | Notes                          |
| ---------------- | --------------------------------------------- | ------------------------------ |
| `scenario_id`    | CHAR(26) PK, FK → scenarios ON DELETE CASCADE |                                |
| `mode`           | ENUM(`history_only`,`history_then_live`)      |                                |
| `target_tps`     | INT UNSIGNED NULL                             |                                |
| `replay_history` | BOOLEAN                                       |                                |
| `label_channel`  | BOOLEAN                                       |                                |
| `updated_at`     | TIMESTAMP                                     |                                |

### 1.6 `run_deliveries` (new; migration 014), for history replay (FR-021)

| Column        | Type                                                   | Notes                                       |
| ------------- | ------------------------------------------------------ | ------------------------------------------- |
| `run_id`      | CHAR(26) FK                                            | PK part                                     |
| `sink_name`   | VARCHAR(120)                                           | PK part                                     |
| `state`       | ENUM(`pending`,`running`,`done`,`failed`,`skipped`)    |                                             |
| `cursor`      | JSON NULL                                              | `{partition_no, row}`, checkpointed every 10k rows |
| `total`       | BIGINT UNSIGNED                                        | rows across `delivered/<sink>/`             |
| `published`   | BIGINT UNSIGNED                                        | acknowledged by the destination             |
| `failed`      | BIGINT UNSIGNED                                        | labeled `delivery_outcome: dropped`         |
| `destination_snapshot` | JSON                                          | the destination actually used (no secrets)  |
| `last_error`  | TEXT NULL                                              |                                             |
| `started_at`, `finished_at` | TIMESTAMP NULL                           |                                             |

```
pending ─▶ running ─▶ done
               └────▶ failed ──retry──▶ running   (continues from cursor)
                        └─────skip──▶ skipped
```

Live auto-start (mode `history_then_live`) fires only when every row is `done` or `skipped`.

### 1.7 `streams` (altered) and `stream_sessions` (new; migration 013)

`streams` stays the per-run controller: one row per run, holding `target_tps` and
`label_channel_enabled`. Its `state` ENUM gains **`error`**. It gains a column
**`destinations`** (JSON): the destinations future sessions will use. It is initialized
from `run_destinations` when the stream row is created, and changed only through
`PUT /runs/:id/stream/destinations` while no session is `streaming`, `paused` or `error`
(FR-048). The launch record in `run_destinations` is never changed.

```
idle ─start─▶ streaming ⇄ paused        (pause/resume)
streaming|paused ─stop─▶ stopped ─start─▶ streaming   (new session seq+1, continues world)
streaming ─breaker trips─▶ error ─stop─▶ stopped
paused ─start─▶ 409 stream_paused
```

`stream_sessions`:

| Column                       | Type                                    | Notes                                                                           |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `id`                         | CHAR(26) PK                             |                                                                                 |
| `stream_id`                  | CHAR(26) FK → streams                   |                                                                                 |
| `seq`                        | INT UNSIGNED                            | UNIQUE(`stream_id`,`seq`). BullMQ jobId is `stream-<runId>-<seq>`              |
| `engine_version`             | INT UNSIGNED                            | must equal the run's (R1)                                                       |
| `destinations_snapshot`      | JSON                                    | `streams.destinations` at session start, without secrets                        |
| `resume_from`                | JSON                                    | `{kind: "history_end"} \| {kind: "session", session_id, day_index}`             |
| `sim_time_ms`                | BIGINT                                  | simulated clock high-water mark                                                 |
| `delivered`, `failed`, `duplicates_injected` | BIGINT UNSIGNED         | counters                                                                        |
| `delivered_since_checkpoint` | INT UNSIGNED                            | written once a second, used for the crash-resume skip when a stalled job is re-run after a worker restart (R7) |
| `last_checkpoint_day`        | INT NULL                                |                                                                                 |
| `last_error`                 | TEXT NULL                               |                                                                                 |
| `started_at`, `ended_at`     | TIMESTAMP                               |                                                                                 |

`streams.metrics` (JSON) gains `sink_lag` (real), `in_flight`, `retry_queue`, `failed_total`,
`aimd_rate` and `sim_time`.

### 1.8 `settings` keys (new)

| Key                       | Value                                                   |
| ------------------------- | ------------------------------------------------------- |
| `local_kafka_seeded`      | `true` once auto-seeded (R15)                           |
| `generation_throughput`   | `{events_per_sec_per_thread, measured_at, source}` (R16) |

## 2. Engine types (`packages/engine`)

| Type                      | Fields                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENGINE_VERSION`          | `2` after this feature                                                                                                                                                  |
| `PartitionWorld`          | `rng`, `consumers: ConsumerState[]`, `merchants` (shared, read-only), `nextDayIndex`, `pendingFraud: MinHeap<ScheduledFraudEvent>`, `recentPurchases: Map<number, PurchaseRing>`, `actorSeq`, `stats: PartitionStatsAccumulator` |
| `ConsumerState`           | `id`, `name`, `archetypeIndex`, `dormantUntilMs: number \| null`, `compromised: boolean`                                                                                 |
| `ScheduledFraudEvent`     | `atMs`, `typology`, `actorId`, `campaignStep`, `draft` (amount, type, counterparty/merchant index)                                                                       |
| `PurchaseRing`            | a fixed array of 16 `{eventId, amount, merchantIndex, tsMs}` plus a head index                                                                                          |
| `DayOutput`               | `events: TruthEvent[]` (sorted by `ts`), `labels: LabelRecord[]` (aligned 1:1 with `events`)                                                                           |
| `WorldCheckpoint`         | `{engineVersion, rngState: [n,n,n,n], nextDayIndex, consumers, pendingFraud, recentPurchases, actorSeq, transformers: Record<sinkName, TransformerState>}`, serialized as gzipped JSON with a SHA-256 |
| `TransformerState`        | `{rngState, delayHeap: DeliveredDraft[], holdSlot: DeliveredDraft \| null}`                                                                                              |
| `Delivered`               | `{delivery_id, event_id, sink, payload: WirePayload, fraudLabel: LabelRecord, corruption?: LabelRecord}`                                                                |
| `CorruptionType`          | unchanged: exactly `duplicate \| late \| out_of_order \| clock_skew` (the four injectable imperfections)                                                                                                 |
| `LabelRecord`             | gains **`delivery_outcome: "dropped" \| null`**: set only on labels the delivery pump writes for events it could not deliver (FR-023). `corruption_type` is `null` on those rows |
| `RunEstimate`             | `{history_events, replay_messages, generation_seconds, partitions, assumptions[]}`                                                                                      |

**Invariants (each has a test)**:

1. `simulateDay` is a pure function of `(world state, dayIndex)`, so history days `0…D−1`
   followed by live days `D…` produce exactly the stream a single uninterrupted simulation
   would produce. This is golden-mastered.
2. `labels[i].event_id === events[i].event_id` for every day output and every aligned file.
3. Every corruption label refers to an `event_id` that is present in that sink's delivered
   output. Every label with `delivery_outcome: "dropped"` refers to one that is *not* acknowledged (SC-004).
4. Dormant consumers emit no `payment` or `income_credit` events while
   `ts < dormantUntilMs`.
5. Peak heap per partition is O(one day + pending fraud + delay heap). It is asserted by the
   30-day vs 90-day benchmark (SC-007).

## 3. Run output layout (data volume)

```
runs/<runId>/
├── truth/part-<n>.parquet                        # simulated-time order
├── truth/part-<n>.stats.json                     # realism accumulators (unchanged role)
├── labels/part-<n>.parquet                       # fraud labels aligned 1:1 with truth rows
├── delivered/<sink>/part-<n>.parquet             # delivery order, wire payload columns (+delivered_at)
├── delivered/<sink>/labels-part-<n>.parquet      # fraud labels aligned 1:1 with delivered rows
├── corruptions/<sink>/part-<n>.parquet           # dup/late/out_of_order/clock_skew labels
├── deliveries/<sink>/dropped-<k>.parquet         # replay/live delivery failures (delivery_outcome = dropped)
├── checkpoints/part-<n>.v<engineVersion>.json.gz # end-of-history world (R7)
├── streams/<sessionId>/part-<n>.day-<d>.json.gz  # live day checkpoints (last 2 kept)
├── stream-labels.jsonl                           # label channel file mirror (unchanged)
├── exports/<exportId>/…                          # built by the export-build worker job (R19); manifest.status: queued → running → completed | failed
└── report.json
```

The answer key for a sink is `labels/*` + `corruptions/<sink>/*` +
`deliveries/<sink>/dropped-*`. The answer key for the truth export is `labels/*`.

## 4. Entity relationships

```
Scenario 1─* SpecVersion
Scenario 1─* ScenarioDestinationDefault *─1 Connection
Scenario 1─0..1 ScenarioLaunchDefault
Scenario 1─* Run ─1 SpecVersion (snapshot)
Run 1─* RunPartition ─0..1 WorldCheckpoint(file)
Run 1─* RunDestination *─0..1 Connection         (snapshot survives delete)
Run 1─* RunDelivery (per bound sink, when replay_history)
Run 1─0..1 Stream (current destinations) 1─* StreamSession (destinations snapshot) ─* LiveCheckpoint(file)
```
