# TxLoom stream processing: Kafka → Flink → ClickHouse

A local, learn-by-doing Flink session cluster that consumes TxLoom's
`txloom-events` Kafka topic, does stateful stream processing (dedup,
event-time ordering, fraud/anomaly detection, windowed features,
sessionization), and hands the results to ClickHouse/Grafana — while
exposing Flink's own runtime (checkpoints, state, watermarks, backpressure)
so its behaviour can be observed and experimented with. See
[PLAN.md](PLAN.md) for the full design rationale and
[LABS.md](LABS.md) for guided exercises.

Defined in [docker-compose-flink.yaml](../docker-compose-flink.yaml), an
overlay on [docker-compose.yml](../docker-compose.yml) like
[docker-compose-analytics.yaml](../docker-compose-analytics.yaml) is — it
reuses the `kafka` service (`demo-brokers` profile) but is otherwise a
fully separate stack (own service names, ports, ClickHouse database), so
it can run side by side with `analytics/`. That stack is Kafka → ClickHouse
directly; this one puts Flink in between.

```
TxLoom worker ──► Kafka  txloom-events  (key = consumer_id, 4 partitions)
                     │                                   │
                     │                                   └──► ClickHouse events_raw   (raw, for comparison)
                     ▼
   ┌──────────────── Flink session cluster (JM + 2 TM, RocksDB, ckpt → MinIO) ────────────────┐
   │ J1 clean-and-order (Java)                                                                 │
   │    watermarks · dedup by event_id (keyed state + TTL) · late/skew side outputs            │
   │      ├─► txloom-flink-clean          (deduped, event-time)                                │
   │      └─► txloom-flink-quality        (late / duplicate / clock-skew records)               │
   │                                                                                           │
   │ reading txloom-flink-clean:                                                               │
   │ S1 velocity-features (SQL, OVER windows)          ─► txloom-flink-features                │
   │ S2 card-testing       (SQL, MATCH_RECOGNIZE)      ─► txloom-flink-alerts                  │
   │ S3 refund-abuse       (SQL, interval join)        ─► txloom-flink-alerts                  │
   │ S4 sessions           (SQL, SESSION window TVF)   ─► txloom-flink-sessions                │
   │ J2 account-takeover   (Java, KeyedProcessFunction + MapState + timers) ─► alerts          │
   │ J3 merchant-anomaly   (Java, windows + EWMA baseline state + broadcast ref data) ─► alerts│
   │                           ▲ txloom-flink-merchant-ref (compacted, hand-published in labs) │
   └───────────────────────────────────────────────────────────────────────────────────────────┘
                     │  Kafka engine tables (isolation.level = read_committed)
                     ▼
   ClickHouse  txloom_flink.*  ──►  Grafana "TxLoom Flink Detections"
   Flink metrics :9249 ──► Prometheus ──►  Grafana "Flink Runtime"
```

Every downstream job reads J1's clean topic, so duplicates/lateness are
handled once, and the raw-vs-clean diff in ClickHouse shows exactly what
Flink removed.

## Run it

```bash
docker compose -f docker-compose.yml -f docker-compose-flink.yaml \
  --profile demo-brokers up -d
```

This starts `kafka` (if not already up), `flink-kafka-init` (creates
`txloom-events` + every `txloom-flink-*` topic, idempotent), `flink-minio` +
`flink-minio-init` (checkpoint/savepoint storage), `flink-jobs-build` (`mvn
package` into a shared volume — re-run this one alone after changing job
code: `docker compose -f docker-compose.yml -f docker-compose-flink.yaml
up flink-jobs-build`), the Flink cluster (JobManager, two TaskManagers, SQL
Gateway), ClickHouse, Prometheus, and Grafana.

**Nothing runs until you submit jobs** — `up` only builds the jar and
starts the cluster:

```bash
analytics-flink/bin/submit-all.sh
```

or submit one at a time with `analytics-flink/bin/submit.sh <job>` (job
names: `clean-and-order`, `account-takeover`, `merchant-anomaly`,
`velocity-features`, `card-testing`, `refund-abuse`, `sessions`) — submit
`clean-and-order` first and let it reach RUNNING before the rest, since
every other job reads its output topic.

| Service | URL | Credentials |
|---|---|---|
| Flink Web UI / REST | http://localhost:8081 | — |
| Flink SQL Gateway | http://localhost:8083 | — |
| MinIO console | http://localhost:9101 | `flinkadmin` / `flinkadmin123` (env `FLINK_MINIO_ACCESS_KEY`/`_SECRET_KEY`) |
| ClickHouse HTTP / `/play` | http://localhost:8124 | `txloom_flink` / `txloom` (env `FLINK_CH_PASSWORD`) |
| ClickHouse native (clickhouse-client) | localhost:9010 | same |
| Prometheus | http://localhost:9091 | — |
| Grafana | http://localhost:3002 | `admin` / `admin` (env `FLINK_GRAFANA_USER`/`_PASSWORD`; only takes effect on a fresh `flink-grafana-data` volume) |

Point a stream at `txloom-events` the same way as for `analytics/` — from
the UI's stream launcher, or `{ "type": "kafka", "config": { "brokers":
["kafka:29092"], "topic": "txloom-events" } }`.

## Layout

```
docker-compose-flink.yaml       # overlay: see root of the repo
analytics-flink/
  PLAN.md                       # design rationale, decisions, caveats
  README.md                     # this file
  LABS.md                       # guided experiments
  bin/                          # submit.sh, submit-all.sh, savepoint.sh, resume.sh, sql-client.sh, produce-merchant-ref.sh
  flink/
    Dockerfile                  # flink:2.2.1-java17 + Kafka SQL connector + flink-cep, S3 plugin
    config.yaml                 # RocksDB, checkpointing, S3/MinIO, Prometheus reporter
  jobs/
    sql/                        # 00_tables.sql (template, see below) + velocity-features/card-testing/refund-abuse/sessions.sql
    java/                       # Maven project: CleanAndOrderJob, AccountTakeoverJob, MerchantAnomalyJob, common/, tests
  clickhouse/                   # named collections, initdb schema (txloom_flink DB)
  prometheus/prometheus.yml
  grafana/                      # provisioning + dashboards (Detections, Flink Runtime)
  queries/                      # ad hoc SQL, one file per question
```

## Jobs

| # | Job | Lang | Logic (defaults, all overridable via `--param value`) |
|---|---|---|---|
| J1 | `clean-and-order` | Java | Key by `event_id`; first delivery wins (state TTL 1h). Watermark = max `ts` − 30s (`--watermark-bound-seconds`), idleness 60s (`--idleness-seconds`, 0 disables it). Late events → quality only; duplicates → quality only; clock-skew (`\|ts − Kafka record ts\| > 60s`, `--clock-skew-threshold-seconds`) → quality, still forwarded. |
| S1 | `velocity-features` | SQL | Per-event consumer 5m/1h txn count+spend, distinct merchants 1h, merchant 5m txn count, via three separate OVER-window scans joined on `event_id` — see the file's header comment for why three, not one query. |
| S2 | `card-testing` | SQL | `MATCH_RECOGNIZE`: ≥3 `payment`s <$10 from one consumer within 10 min. |
| S3 | `refund-abuse` | SQL | Interval join (refund ↔ prior payment, same consumer/merchant/amount, within 5h) + refund velocity (≥2 refunds/consumer/24h, HOP window TVF). |
| S4 | `sessions` | SQL | Per-consumer sessions (`SESSION` window TVF, 10 min gap): count, spend, distinct channels, duration. |
| J2 | `account-takeover` | Java | Per consumer: after ≥ `--dormancy-hours` (default 168) of inactivity, ≥ `--drain-count-threshold` (default 3) `p2p_transfer`s of ≥ `--transfer-amount-threshold` (default 500) to previously-unseen counterparties within `--drain-window-hours` (default 2) → alert. An event-time timer closes the window and emits the summary. Also tracks an EWMA of transfer amount for a deviation score. |
| J3 | `merchant-anomaly` | Java | 1-min per-merchant volume/decline-rate windows; EWMA mean/variance of volume in keyed state; z-score > `--z-score-threshold` (default 3) after `--warmup-windows` (default 10) → alert. Broadcasts `txloom-flink-merchant-ref` to enrich alerts with `merchant_risk_tier`. |

Detector thresholds mirror how the generator builds each typology
(`packages/engine/src/fraud/*.ts`).

### SQL jobs and `00_tables.sql`

`jobs/sql/00_tables.sql` is a **template**, not a runnable file on its own:
it declares the shared `clean_events` source table and `alerts_sink` sink
table with `${GROUP_ID}`/`${TXN_PREFIX}` placeholders. `bin/submit.sh`
substitutes job-unique values and prepends it to whichever job file you
submit — every job that reads `txloom-flink-clean` needs its own Kafka
consumer group (else Kafka splits the topic's partitions across jobs and
each one silently sees only part of the stream), and every exactly-once
Kafka sink needs a transactional-id prefix unique across the cluster.
**Never submit a `.sql` job file directly with `sql-client.sh -f`** — it
has no source/sink tables without `00_tables.sql` prepended; use
`bin/submit.sh` instead.

## ClickHouse (`txloom_flink` database)

Same Kafka-engine-table + materialized-view pattern as `analytics/`: one
String column ingested as-is, typed columns extracted via `JSONExtract*` so
a job's schema drifting never fails ingestion. Every named collection for a
Flink output topic sets `isolation_level = read_committed` — these topics
are written by transactional, exactly-once `KafkaSink`s, so an
aborted/uncommitted transaction's records must never surface (this also
means these tables lag their job by up to one checkpoint interval, 10s).

| Table | Source | Notes |
|---|---|---|
| `events_raw` | `txloom-events` | Own consumer group from `analytics/`'s — the two stacks don't fight over partitions. |
| `events_clean` | `txloom-flink-clean` | J1's output; same typed shape as `events_raw` for direct diffing. |
| `quality` | `txloom-flink-quality` | J1's duplicate/late/clock_skew side outputs. |
| `alerts` | `txloom-flink-alerts` | `ReplacingMergeTree(emitted_at)` on `alert_id` (deterministic hash of detector+entity+window) — second line of defence on top of exactly-once. |
| `features` | `txloom-flink-features` | S1's per-event velocity features. |
| `sessions` | `txloom-flink-sessions` | S4's per-consumer sessions. |
| `raw_vs_clean` | view | Per-minute raw vs. clean counts, duplicates dropped, late events. |

## Grafana

- **TxLoom Flink Detections** (ClickHouse): alerts/min by detector, latest
  alerts, top flagged consumers/merchants, raw-vs-clean throughput,
  duplicates/late/skew, velocity feature distributions, session stats.
- **Flink Runtime** (Prometheus): records in/out per operator,
  backpressure/busy time, checkpoint duration/size/failures, RocksDB state
  size, watermark lag, Kafka consumer lag, restarts. A few panel queries
  are best-effort against Flink's Prometheus reporter metric names and are
  flagged (via each panel's `description`) as unverified against a live
  cluster — see "Verified so far" below.

## Troubleshooting

- **Create a topic before the first message lands on it.** Same gotcha as
  `analytics/`: if ClickHouse's Kafka engine table subscribes before the
  topic exists, its consumer group can get stuck on `Unknown topic or
  partition` even after the topic shows up. `flink-kafka-init` creates
  every topic on `up`, so this should only bite if you add a new topic by
  hand; fix is `DETACH TABLE ...; ATTACH TABLE ...;` (or restart
  `flink-clickhouse`) once the topic exists.
- **`txloom_flink` user needs `NAMED COLLECTION` access** — granted by
  `clickhouse/users.d/named-collections.xml`. Without it the first
  `initdb` run fails and every later file in `initdb/` is skipped for that
  boot; recreate against a fresh `flink-clickhouse-data` volume after
  fixing it.
- **`txloom-events` may already exist with 1 partition** (auto-created by
  an earlier run of something else). `flink-kafka-init` only creates it
  `--if-not-exists`; with 1 partition, `parallelism.default: 2` on J1's
  source leaves an idle subtask, which is exactly what LABS.md #4
  demonstrates. Fix (if you want 4 partitions instead):
  `docker compose exec kafka kafka-topics --alter --topic txloom-events
  --partitions 4 --bootstrap-server localhost:9092`.
- **A SQL job submitted without `00_tables.sql`** fails immediately with a
  missing-table error — see "SQL jobs and `00_tables.sql`" above; always go
  through `bin/submit.sh`.
- **Exactly-once visibility latency = checkpoint interval (10s).** A
  transactional sink only commits on checkpoint, and `read_committed`
  consumers (ClickHouse, downstream SQL jobs) only see committed data —
  don't expect a row in ClickHouse the instant a job processes an event.

## Verified so far

This stack was built and reviewed without a live cluster run (no Docker
daemon in the build environment). What **has** been verified directly:

- The Java module (`jobs/java`) compiles cleanly against the exact pinned
  versions (Flink 2.2.1, `flink-connector-kafka`/`flink-connector-base`
  5.0.0-2.2 / 2.2.1) and packages into a shaded jar with all required
  classes present (confirmed via `mvn compile`, `mvn test`, `mvn package`
  and inspecting the resulting jar).
- `CleanAndOrderJobTest` and `AccountTakeoverJobTest` (7 tests total) pass,
  exercising J1's dedup/late/clock-skew logic and J2's drain-window
  detection directly against the process functions via
  `ProcessFunctionTestHarnesses`, no Kafka/MiniCluster required.
- Every Flink SQL construct used (Kafka connector table options,
  `MATCH_RECOGNIZE`, windowing TVFs, `StateTtlConfig`, S3/MinIO config
  keys, Docker image tags, Maven artifact coordinates) was checked against
  the Flink 2.2 documentation and, for artifact versions, against Maven
  Central directly.

**Not yet run end-to-end**: the actual `docker compose up` (cluster
bring-up, topic creation, checkpointing to MinIO), submitting jobs against
a live JobManager/SQL Gateway, ClickHouse ingestion from real Flink output,
and the Grafana dashboards against real data. Treat the first real run as
part of working through [LABS.md](LABS.md) #1, and expect to need small
fixes — the "To verify during implementation" list in
[PLAN.md](PLAN.md) has the specific risk areas.
