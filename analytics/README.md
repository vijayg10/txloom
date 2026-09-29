# TxLoom stream analytics: Kafka → ClickHouse → Grafana

Consumes live events from the demo Kafka broker, ingests them into
ClickHouse, and visualizes them in Grafana. Defined in
[docker-compose-analytics.yaml](../docker-compose-analytics.yaml), an
overlay on the main [docker-compose.yml](../docker-compose.yml) — it is not
a standalone project; it reuses the `kafka` service already defined there
(`demo-brokers` profile).

```
Kafka (kafka:29092, topic txloom-events)
  │  ENGINE = Kafka(txloom_kafka)      — clickhouse/config.d/kafka.xml
  ▼
events_kafka  (one message per row, raw String)
  │  MATERIALIZED VIEW events_kafka_mv — extracts typed columns via JSONExtract*
  ▼
events_raw    (MergeTree, every delivery kept, duplicates included, 30d TTL)
  │                                    │
  │  view: latest per event_id        │  MATERIALIZED VIEWs, incremental
  ▼                                    ▼
events        (deduped)          events_1m, merchant_1h   (AggregatingMergeTree rollups)
  │                                    │
  └──────────────┬─────────────────────┘
                 ▼
     analytics/queries/*.sql  +  Grafana dashboard (analytics/grafana/dashboards/txloom.json)
```

## Run it

```bash
docker compose -f docker-compose.yml -f docker-compose-analytics.yaml \
  --profile demo-brokers up -d
```

This starts (or reuses) `kafka`, plus `clickhouse` and `grafana`. First
start runs `analytics/clickhouse/initdb/*.sql` against a fresh
`clickhouse-data` volume (the official image only runs
`/docker-entrypoint-initdb.d` when the data dir is empty — `down -v` before
re-running init changes).

| Service | URL | Credentials |
|---|---|---|
| ClickHouse HTTP / `/play` | http://localhost:8123 | `txloom` / `txloom` (env `ANALYTICS_CH_PASSWORD`) |
| ClickHouse native (clickhouse-client) | localhost:9000 | same |
| Grafana | http://localhost:3001 | `admin` / `admin` (env `ANALYTICS_GRAFANA_USER`/`_PASSWORD`) — only takes effect on a fresh `grafana-data` volume; an existing volume keeps whatever admin password was already set |

Point a stream at it — from the UI's stream launcher, or:

```json
{ "type": "kafka", "config": { "brokers": ["kafka:29092"], "topic": "txloom-events" } }
```

`txloom-events` is the default `ANALYTICS_KAFKA_TOPIC`; change both the
stream's sink config and the env var together if you use a different topic.
**Create the topic before the first event is published to it** — see
Known gaps below.

## Layout

```
analytics/
  clickhouse/
    config.d/kafka.xml      # named collection `txloom_kafka`: brokers/topic/group from env
    users.d/named-collections.xml  # grants the `txloom` user NAMED COLLECTION access
    initdb/
      01_events.sql         # events_kafka (Kafka engine) -> events_kafka_mv -> events_raw
      02_dedup_view.sql     # events: latest delivery per event_id
      03_rollups.sql        # events_1m, merchant_1h (AggregatingMergeTree + MVs)
  grafana/
    provisioning/datasources/clickhouse.yaml
    provisioning/dashboards/dashboards.yaml
    dashboards/txloom.json  # "TxLoom Stream Analytics" dashboard, 12 panels
  queries/                  # ad-hoc SQL, one file per question (see below)
  README.md                 # this file
```

## Schema

`events_raw` is the source of truth: one row per Kafka message, duplicates
included, 30-day TTL, partitioned by day, ordered by `(ts, consumer_id)`.
Typed columns cover the common `TruthEvent` fields
(`packages/engine/src/types.ts`); the full message is also kept in `raw
String`, so scenario-specific fields stay queryable with
`JSONExtract*(raw, 'field')` even though they have no dedicated column. A
missing or renamed field yields an empty/default value instead of a failed
insert — new scenario shapes don't break ingestion.

`events` is a view over `events_raw` keeping the first delivery
(`ingested_at`, then Kafka offset) per `event_id`. Use it for anything that
should not double-count injected duplicate deliveries.

`events_1m` and `merchant_1h` are `AggregatingMergeTree` rollups fed by
materialized views on every insert into `events_raw`. Because a materialized
view only sees the just-inserted block, it cannot dedup across separate
deliveries of the same event: **event counts use `uniqExact`/`uniqExactIf`
and stay exact; `amount` sums do not and include duplicate deliveries.** For
an exact total, query `events` directly (cheap at demo volume) rather than
the rollup.

## Queries (`analytics/queries/`)

- `timeseries.sql` — events/amount per minute, by type/status/channel/currency; throughput.
- `merchants.sql` — top merchants by volume/value, decline rate by channel+type.
- `consumers.sql` — top spenders, amount quantiles by event type.
- `velocity.sql` — most active consumers in the last 5 min; per-event sliding-window (5 min / 1 h) transaction and spend counts, the kind of feature a fraud model would compute.
- `data_quality.sql` — duplicate deliveries, ingestion-lag percentiles, out-of-order detection per Kafka partition, missing/zero core fields.

## Grafana

One dashboard, **TxLoom Stream Analytics** (`analytics/grafana/dashboards/txloom.json`,
provisioned into the `TxLoom` folder, 10s auto-refresh): stat tiles
(events/sec, events, amount, duplicate count), time series by type / status /
channel / currency, top merchants, top consumers, velocity, and ingestion-lag
percentiles. The ClickHouse datasource (native protocol, `clickhouse:9000`)
is provisioned from `provisioning/datasources/clickhouse.yaml`.

## Known gaps

- **Ground-truth labels are not ingested.** The live label channel
  (FR-030a) currently writes to `runs/<run_id>/stream-labels.jsonl`
  (`apps/worker/src/jobs/stream-label-channel.ts`), not to Kafka, so there is
  no `labels` table here and the fraud/corruption-label queries called for
  in planning are deferred. Publishing labels to a Kafka topic (e.g.
  `<event-topic>.labels`) is a worker-side change, tracked separately; once
  it exists, add a second `ENGINE = Kafka(...)` table + MV following the
  pattern in `initdb/01_events.sql`.
- **Create the topic before the first publish to it.** If ClickHouse's Kafka
  table subscribes to a topic that doesn't exist yet, the consumer group
  caches an `Unknown topic or partition` error and keeps failing to get an
  assignment even after the topic is created. Symptom:
  `system.kafka_consumers.exceptions.text` shows that error and
  `num_messages_read` stays 0 forever. Fix: `DETACH TABLE
  txloom_analytics.events_kafka; ATTACH TABLE txloom_analytics.events_kafka;`
  (or restart the `clickhouse` container) once the topic exists.
- **Rollup amounts include duplicate deliveries** (see Schema above) — by
  design, not a bug; use `events` for exact totals.
- **The `txloom` user needs `NAMED_COLLECTION` access** to create a table
  with `ENGINE = Kafka(txloom_kafka)`; `users.d/named-collections.xml`
  grants it. Without that file the first `initdb` run fails with `Not enough
  privileges ... grant NAMED COLLECTION ON txloom_kafka` and every later
  `.sql` file in `initdb/` is skipped for that boot (the entrypoint stops on
  the first error) — recreate the container against a fresh volume after
  fixing it, rather than assuming a later boot will retry the skipped files.
- **Grafana's `GF_SECURITY_ADMIN_PASSWORD` only applies to a brand-new
  `grafana-data` volume.** If that volume already exists (from an earlier
  run, or a password changed by hand), the env var is silently ignored and
  the previously-set password stays in effect.

## Validated

Two passes, against this compose file:

1. **Direct producer.** 205 synthetic UPI-style JSON events (with 5
   duplicate deliveries) produced straight to the `txloom-events` topic
   landed in `events_raw` as 205 rows / 200 distinct `event_id`s;
   `events_1m` and `merchant_1h` rollup totals matched the dedup view
   exactly; `analytics/queries/merchants.sql`, `data_quality.sql`, and the
   velocity query all returned correct results.
2. **Real app path.** A scenario launched with `mode: "batch_then_stream"`,
   then `POST /runs/:id/stream/start` (`upi-stream` sink, `kafka:29092`,
   topic `txloom-events`, target 10 TPS) — i.e. through the actual worker
   (`apps/worker/src/jobs/stream-drive.ts`) and Kafka producer
   (`packages/sinks/src/kafka/producer.ts`), not a direct producer. 399
   events landed in `events_raw` with the app's real ID scheme
   (`cons_N`/`mch_N`, ULID `event_id`s), 9.05 achieved TPS against a target
   of 10, zero backpressure, zero sink lag.

The Grafana dashboard's ClickHouse datasource passed its health check and
rendered live panel queries successfully against this data.
