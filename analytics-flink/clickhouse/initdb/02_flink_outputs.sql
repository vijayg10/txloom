-- Flink output topics -> ClickHouse. Same Kafka-engine-table + MV pattern as
-- 01_raw.sql (and analytics/clickhouse/initdb/01_events.sql): one String
-- column ingested as-is, typed columns extracted in a materialized view via
-- JSONExtract* so a job's schema drifting (new/renamed field) never fails
-- ingestion, it just leaves the new column blank until the MV is updated.
--
-- Every named collection here (config.d/kafka.xml) sets
-- isolation_level = read_committed: these topics are written by Flink's
-- transactional, exactly-once KafkaSinks, so an aborted/uncommitted
-- transaction's records must never surface here. That also means these
-- tables lag the job by up to one checkpoint interval (10s) — see
-- PLAN.md "Exactly-once visibility latency".

-- txloom-flink-clean -> events_clean -----------------------------------------
-- J1's deduped, watermarked output. Same typed shape as events_raw so the
-- two can be diffed directly (see raw_vs_clean in 03_views.sql).

CREATE TABLE IF NOT EXISTS txloom_flink.events_clean
(
    event_id        String,
    delivery_id     String,
    ts              DateTime64(3, 'UTC'),
    type            LowCardinality(String),
    status          LowCardinality(String),
    amount          Decimal64(4),
    currency        LowCardinality(String),
    consumer_id     String,
    consumer_name   String,
    merchant_id     Nullable(String),
    merchant_name   Nullable(String),
    counterparty_id Nullable(String),
    channel         LowCardinality(String),
    partition_no    UInt32,
    ingested_at     DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (ts, consumer_id)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS txloom_flink.events_clean_kafka
(
    raw String
)
ENGINE = Kafka(txloom_flink_clean);

CREATE MATERIALIZED VIEW IF NOT EXISTS txloom_flink.events_clean_kafka_mv
TO txloom_flink.events_clean
AS
SELECT
    JSONExtractString(raw, 'event_id')                                  AS event_id,
    if(JSONHas(raw, 'delivery_id'), JSONExtractString(raw, 'delivery_id'),
       JSONExtractString(raw, 'event_id'))                              AS delivery_id,
    coalesce(parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'ts'), 3, 'UTC'),
             _timestamp_ms, now64(3))                                   AS ts,
    JSONExtractString(raw, 'type')                                      AS type,
    JSONExtractString(raw, 'status')                                    AS status,
    toDecimal64OrZero(JSONExtractRaw(raw, 'amount'), 4)                 AS amount,
    JSONExtractString(raw, 'currency')                                  AS currency,
    JSONExtractString(raw, 'consumer_id')                               AS consumer_id,
    JSONExtractString(raw, 'consumer_name')                             AS consumer_name,
    JSONExtract(raw, 'merchant_id', 'Nullable(String)')                 AS merchant_id,
    JSONExtract(raw, 'merchant_name', 'Nullable(String)')               AS merchant_name,
    JSONExtract(raw, 'counterparty_id', 'Nullable(String)')             AS counterparty_id,
    JSONExtractString(raw, 'channel')                                   AS channel,
    JSONExtractUInt(raw, 'partition_no')                                AS partition_no,
    now64(3)                                                            AS ingested_at
FROM txloom_flink.events_clean_kafka;

-- txloom-flink-quality -> quality --------------------------------------------
-- J1's side outputs: duplicates dropped, late arrivals, clock-skewed events.
-- lateness_ms/skew_ms are only set for their respective `kind`.

CREATE TABLE IF NOT EXISTS txloom_flink.quality
(
    event_id     String,
    ts           DateTime64(3, 'UTC'),
    type         LowCardinality(String),
    consumer_id  String,
    merchant_id  Nullable(String),
    amount       Decimal64(4),
    currency     LowCardinality(String),
    channel      LowCardinality(String),
    kind         LowCardinality(String), -- duplicate | late | clock_skew
    lateness_ms  Nullable(Int64),
    skew_ms      Nullable(Int64),
    detected_at  DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (kind, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS txloom_flink.quality_kafka
(
    raw String
)
ENGINE = Kafka(txloom_flink_quality);

CREATE MATERIALIZED VIEW IF NOT EXISTS txloom_flink.quality_kafka_mv
TO txloom_flink.quality
AS
SELECT
    JSONExtractString(raw, 'event_id')                                  AS event_id,
    coalesce(parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'ts'), 3, 'UTC'),
             _timestamp_ms, now64(3))                                   AS ts,
    JSONExtractString(raw, 'type')                                      AS type,
    JSONExtractString(raw, 'consumer_id')                               AS consumer_id,
    JSONExtract(raw, 'merchant_id', 'Nullable(String)')                 AS merchant_id,
    toDecimal64OrZero(JSONExtractRaw(raw, 'amount'), 4)                 AS amount,
    JSONExtractString(raw, 'currency')                                  AS currency,
    JSONExtractString(raw, 'channel')                                   AS channel,
    JSONExtractString(raw, 'kind')                                      AS kind,
    JSONExtract(raw, 'lateness_ms', 'Nullable(Int64)')                  AS lateness_ms,
    JSONExtract(raw, 'skew_ms', 'Nullable(Int64)')                      AS skew_ms,
    coalesce(parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'detected_at'), 3, 'UTC'),
             _timestamp_ms, now64(3))                                   AS detected_at
FROM txloom_flink.quality_kafka;

-- txloom-flink-alerts -> alerts ----------------------------------------------
-- Unified alert schema across all four detectors (PLAN.md). ReplacingMergeTree
-- on alert_id: alert_id is a deterministic hash of detector+entity+window, so
-- a replay after failover produces the same id and the newest emitted_at wins
-- — this is a second line of defence on top of the sink's exactly-once write.

CREATE TABLE IF NOT EXISTS txloom_flink.alerts
(
    alert_id          String,
    detector          LowCardinality(String),
    entity_type       LowCardinality(String),
    entity_id         String,
    window_start      DateTime64(3, 'UTC'),
    window_end        DateTime64(3, 'UTC'),
    score             Float64,
    event_ids         Array(String),
    -- Full details object kept as raw JSON; shape varies by detector.
    details           String CODEC(ZSTD(3)),
    merchant_risk_tier Nullable(String),
    emitted_at        DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(emitted_at)
PARTITION BY toYYYYMMDD(window_start)
ORDER BY alert_id
TTL toDateTime(window_start) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS txloom_flink.alerts_kafka
(
    raw String
)
ENGINE = Kafka(txloom_flink_alerts);

CREATE MATERIALIZED VIEW IF NOT EXISTS txloom_flink.alerts_kafka_mv
TO txloom_flink.alerts
AS
SELECT
    JSONExtractString(raw, 'alert_id')                                  AS alert_id,
    JSONExtractString(raw, 'detector')                                  AS detector,
    JSONExtractString(raw, 'entity_type')                               AS entity_type,
    JSONExtractString(raw, 'entity_id')                                 AS entity_id,
    coalesce(parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'window_start'), 3, 'UTC'),
             _timestamp_ms, now64(3))                                   AS window_start,
    coalesce(parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'window_end'), 3, 'UTC'),
             _timestamp_ms, now64(3))                                   AS window_end,
    JSONExtractFloat(raw, 'score')                                      AS score,
    JSONExtract(raw, 'event_ids', 'Array(String)')                      AS event_ids,
    -- `details` is itself a JSON object, but Alert serializes it as a JSON
    -- *string* field (see Alert.java / 00_tables.sql), so the raw message
    -- has it double-encoded (quoted, with escaped inner quotes).
    -- JSONExtractString un-escapes back to plain JSON text so downstream
    -- JSONExtract*(details, ...) queries work directly; JSONExtractRaw
    -- would keep the escaping and quotes.
    JSONExtractString(raw, 'details')                                   AS details,
    JSONExtract(raw, 'merchant_risk_tier', 'Nullable(String)')          AS merchant_risk_tier,
    coalesce(parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'emitted_at'), 3, 'UTC'),
             _timestamp_ms, now64(3))                                   AS emitted_at
FROM txloom_flink.alerts_kafka;

-- txloom-flink-features -> features -------------------------------------------
-- S1 velocity-features.sql: one row per clean event, streaming counterpart of
-- analytics/queries/velocity.sql's sliding-window query.

CREATE TABLE IF NOT EXISTS txloom_flink.features
(
    event_id                         String,
    consumer_id                      String,
    merchant_id                      Nullable(String),
    ts                                DateTime64(3, 'UTC'),
    consumer_txn_count_5m             UInt32,
    consumer_spend_5m                 Decimal64(4),
    consumer_txn_count_1h             UInt32,
    consumer_spend_1h                 Decimal64(4),
    consumer_distinct_merchants_1h    UInt32,
    merchant_txn_count_5m             Nullable(UInt32)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (consumer_id, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS txloom_flink.features_kafka
(
    raw String
)
ENGINE = Kafka(txloom_flink_features);

CREATE MATERIALIZED VIEW IF NOT EXISTS txloom_flink.features_kafka_mv
TO txloom_flink.features
AS
SELECT
    JSONExtractString(raw, 'event_id')                                  AS event_id,
    JSONExtractString(raw, 'consumer_id')                               AS consumer_id,
    JSONExtract(raw, 'merchant_id', 'Nullable(String)')                 AS merchant_id,
    coalesce(parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'ts'), 3, 'UTC'),
             _timestamp_ms, now64(3))                                   AS ts,
    JSONExtractUInt(raw, 'consumer_txn_count_5m')                       AS consumer_txn_count_5m,
    toDecimal64OrZero(JSONExtractRaw(raw, 'consumer_spend_5m'), 4)      AS consumer_spend_5m,
    JSONExtractUInt(raw, 'consumer_txn_count_1h')                       AS consumer_txn_count_1h,
    toDecimal64OrZero(JSONExtractRaw(raw, 'consumer_spend_1h'), 4)      AS consumer_spend_1h,
    JSONExtractUInt(raw, 'consumer_distinct_merchants_1h')              AS consumer_distinct_merchants_1h,
    JSONExtract(raw, 'merchant_txn_count_5m', 'Nullable(UInt32)')       AS merchant_txn_count_5m
FROM txloom_flink.features_kafka;

-- txloom-flink-sessions -> sessions -------------------------------------------
-- S4 sessions.sql: SESSION window TVF output (10 min inactivity gap).
-- ReplacingMergeTree because a session can be re-emitted (allowed lateness /
-- late-firing) before the window is truly final; the latest write wins.

CREATE TABLE IF NOT EXISTS txloom_flink.sessions
(
    consumer_id      String,
    session_start     DateTime64(3, 'UTC'),
    session_end       DateTime64(3, 'UTC'),
    event_count       UInt32,
    total_spend       Decimal64(4),
    channels          Array(String),
    duration_seconds  UInt32
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMMDD(session_start)
ORDER BY (consumer_id, session_start)
TTL toDateTime(session_start) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS txloom_flink.sessions_kafka
(
    raw String
)
ENGINE = Kafka(txloom_flink_sessions);

CREATE MATERIALIZED VIEW IF NOT EXISTS txloom_flink.sessions_kafka_mv
TO txloom_flink.sessions
AS
SELECT
    JSONExtractString(raw, 'consumer_id')                               AS consumer_id,
    coalesce(parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'session_start'), 3, 'UTC'),
             _timestamp_ms, now64(3))                                   AS session_start,
    coalesce(parseDateTime64BestEffortOrNull(JSONExtractString(raw, 'session_end'), 3, 'UTC'),
             _timestamp_ms, now64(3))                                   AS session_end,
    JSONExtractUInt(raw, 'event_count')                                 AS event_count,
    toDecimal64OrZero(JSONExtractRaw(raw, 'total_spend'), 4)            AS total_spend,
    JSONExtract(raw, 'channels', 'Array(String)')                       AS channels,
    JSONExtractUInt(raw, 'duration_seconds')                            AS duration_seconds
FROM txloom_flink.sessions_kafka;
