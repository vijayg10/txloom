# Data Model: TxLoom — Synthetic Transaction Studio (v1)

**Date**: 2026-07-11 | **Plan**: [plan.md](./plan.md)

Two stores: **MySQL** (metadata, via Knex — no ORM) and the **run-output volume** (truth,
labels, exports, reports as files). MySQL never holds events; the volume never holds
authoritative metadata. All JSON documents are `JSON` columns (utf8mb4).

## MySQL schema

### scenarios

| Column | Type | Notes |
|---|---|---|
| id | char(26) PK | ULID |
| name | varchar(120) | unique |
| description | text | nullable |
| currency | char(3) | ISO 4217; single currency per scenario (clarification #3) |
| current_version_id | char(26) FK → spec_versions | head of version history |
| template_slug | varchar(60) | nullable; provenance if cloned from a template |
| created_at / updated_at | timestamp | |

### spec_versions

Append-only; rollback creates a new head pointing at old content (FR-005).

| Column | Type | Notes |
|---|---|---|
| id | char(26) PK | |
| scenario_id | char(26) FK | indexed |
| version_no | int | monotonic per scenario; unique (scenario_id, version_no) |
| spec | json | full simulation spec document |
| author_type | enum('user','agent','rollback') | provenance; `agent` = saved via an MCP tool call |
| parent_version_id | char(26) | nullable |
| created_at | timestamp | |

### runs

| Column | Type | Notes |
|---|---|---|
| id | char(26) PK | |
| scenario_id | char(26) FK | indexed |
| spec_version_id | char(26) FK | |
| spec_snapshot | json | verbatim copy at launch — the immutable record (FR-033) |
| seed | bigint unsigned | run-scoped |
| params | json | scale override, selected sink connection ids, label-channel opt-in |
| mode | enum('batch','batch_then_stream') | |
| status | enum('queued','running','paused','completed','failed','cancelled') | see lifecycle |
| outputs_deleted_at | timestamp null | manual delete keeps this row (clarification #2, FR-033a) |
| progress | json | per-partition summary cache for the run list |
| error | text null | terminal failure detail |
| created_at / started_at / completed_at | timestamp | |

**Run lifecycle**: `queued → running ⇄ paused → completed | failed | cancelled`. Terminal rows
are immutable except `outputs_deleted_at`. Resume after crash re-enters `running` from partition
checkpoints; truth events are never duplicated (FR-018, SC-011).

### run_partitions

| Column | Type | Notes |
|---|---|---|
| run_id | char(26) FK | composite PK (run_id, partition_no) |
| partition_no | smallint | deterministic slice of persona space |
| state | enum('pending','running','done','failed') | |
| rng_checkpoint | json | serialized PRNG stream state + virtual-clock cursor (D7) |
| events_generated | bigint | |
| updated_at | timestamp | |

### streams

One row per live-streaming phase of a run (mode `batch_then_stream`).

| Column | Type | Notes |
|---|---|---|
| id | char(26) PK | |
| run_id | char(26) FK unique | continuity with history phase (FR-029) |
| state | enum('idle','streaming','paused','stopped') | |
| target_tps | int | live-adjustable (FR-030) |
| label_channel_enabled | boolean | opt-in parallel label channel (FR-030a) |
| metrics | json | last achieved tps, sink lag, backpressure flag (gauge cache) |
| started_at / stopped_at | timestamp | |

**Stream lifecycle**: `idle → streaming ⇄ paused → stopped`; world state persists across pauses.

### sink_connections

| Column | Type | Notes |
|---|---|---|
| id | char(26) PK | |
| type | enum('file','kafka','rabbitmq','webhook') | v1 set (FR-026) |
| name | varchar(120) | unique |
| config | json | non-secret config: brokers/topic/partitioning, exchange/routing key, URL, formats |
| credentials_enc | varbinary | AES-256-GCM envelope (D14); null for file and webhook (no signing secret — D15) |
| last_test_at / last_test_ok | timestamp / boolean | test-connection state |
| created_at / updated_at | timestamp | |

### templates

Seeded at migration time; read-only in v1 (UPI-style, card-present retail, mobile money,
marketplace payouts — FR-006). Name-dictionary packs (per locale: given/family names, merchant
naming patterns) ship as static, sourced engine data files, selected by each template spec's
`locale` (FR-014a) — same pattern as `benchmark_refs`.

| Column | Type | Notes |
|---|---|---|
| slug | varchar(60) PK | |
| name / description | varchar / text | |
| spec | json | complete starter spec |
| benchmark_refs | json | sourced reference aggregates for realism comparison (D17, FR-007) |

### settings

| Column | Type | Notes |
|---|---|---|
| key | varchar(60) PK | e.g. `defaults.*` (global defaults); optional-module settings (e.g. a future AI-assist plugin's provider config) namespace under the module name |
| value | json | secrets referenced here are stored encrypted (credentials pattern as sinks) |
| updated_at | timestamp | |

## Run-output volume layout

```text
data/
├── keys/instance.key                      # created on first boot (D14)
└── runs/<run_id>/
    ├── truth/part-<n>.parquet             # truth events per partition (immutable)
    ├── labels/part-<n>.parquet            # answer key: fraud + corruption labels
    ├── exports/<export_id>/…              # user-requested CSV/Parquet/JSON exports
    ├── report.json                        # realism report (also cached in UI via API)
    └── stream-labels.jsonl                # recorded truth for streamed events (FR-030a)
```

Deleting a run's outputs removes `runs/<run_id>/` and stamps `runs.outputs_deleted_at`; the
MySQL row (spec snapshot + seed) remains for one-click regeneration.

## Event shapes (Parquet/JSON schema, `packages/spec` types)

### TruthEvent

| Field | Type | Notes |
|---|---|---|
| event_id | string (ULID) | globally unique, deterministic derivation |
| ts | timestamp (virtual clock) | never skewed — truth time |
| type | enum: payment, p2p_transfer, income_credit, refund | instrument scope (assumption) |
| status | enum: approved, declined, reversed | minimal outcome set (clarification #1, FR-015a) |
| amount | decimal(18,2) | scenario currency |
| currency | char(3) | constant per scenario |
| consumer_id / merchant_id | string | merchant null for p2p/income |
| consumer_name / merchant_name | string | stable display names assigned once at world instantiation from the locale's dictionary pack (FR-014a); merchant_name null for p2p/income |
| counterparty_id | string null | p2p target (e.g., mule/drain destination) |
| counterparty_name | string null | counterparties are consumers — named the same way |
| channel | string | e.g. upi, card_present, wallet — template-dependent |
| partition_no | int | provenance |

### LabelRecord (answer key — separate export by default, FR-021)

| Field | Type | Notes |
|---|---|---|
| event_id | string | join key to TruthEvent / delivered event |
| is_fraud | boolean | |
| typology | enum: card_testing, account_takeover, refund_abuse, null | |
| actor_id | string null | fraud actor behind the event (FR-020) |
| campaign_step | int null | position in the typology script (actor story rendering) |
| corruption_type | enum: duplicate, late, out_of_order, clock_skew, null | delivery imperfections (FR-025) |
| corruption_detail | json null | e.g. duplicate ordinal, injected delay seconds, skew offset |
| sink | string null | which delivery the corruption applied to |

### DeliveredEvent

TruthEvent projected per sink schema, minus label fields, with delivery envelope
(`delivery_id`, delivered `ts` possibly late/skewed, sink partition/routing metadata). Duplicates
share `event_id`, differ in `delivery_id`.

## Spec document (authoritative JSON Schema lives in `packages/spec`)

Top-level keys (FR-002): `seed`, `currency`, `locale` (selects the name-dictionary pack for
party display names, FR-014a), `clock {start, days, then_stream_tps?}`,
`population {consumers {count, archetypes[]}, merchants {count, categories{}}}`,
`seasonality[] {event, window[2], volume_multiplier}`,
`fraud {target_rate, typologies[] (card_testing | account_takeover | refund_abuse with shares,
burst/precondition/behavior params)}`, `outcomes {baseline_decline_rate}`,
`imperfections {duplicate_delivery, late_arrival, out_of_order, clock_skew}`,
`output {sinks[], labels: 'separate_export' | 'merged_with_warning', stream_label_channel?}`.

**Key semantic invariants** (each is a typed function returning JSON-Pointer-located violations,
FR-003/004): seasonality windows intersect the clock window; archetype weights and typology
shares sum to 1 (±ε); fraud target_rate ∈ [0, 0.5]; account_takeover dormancy precondition
satisfiable within clock.days; imperfection rates ∈ [0, 0.2]; imperfection sink targeting refers
to selected output sinks; clock_skew sources reference declared sources; locale references a
shipped name-dictionary pack; then_stream_tps within
documented envelope (≤ benchmark-backed maximum); population within documented scale envelope
(warn above reference scale).

## Relationships

```text
templates ──clone──▶ scenarios 1──▶ * spec_versions (append-only history)
scenarios 1──▶ * runs ──snapshot──▶ spec (verbatim json)
runs 1──▶ * run_partitions          runs 1──▶ 0..1 streams
runs ──params.sink_ids──▶ * sink_connections
runs 1──▶ volume: truth/labels/exports/report (until manual delete)
```
