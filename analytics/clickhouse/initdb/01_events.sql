-- Kafka -> events_raw ingestion.
--
--   events_kafka (Kafka engine, one String per message)
--        │  events_kafka_mv (extracts typed fields)
--        ▼
--   events_raw (MergeTree, every delivery kept — duplicates included)

CREATE DATABASE IF NOT EXISTS txloom_analytics;

CREATE TABLE IF NOT EXISTS txloom_analytics.events_raw
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
    -- Full message, so scenario-specific fields stay queryable via JSONExtract*.
    raw             String CODEC(ZSTD(3)),
    -- Kafka metadata
    kafka_topic     LowCardinality(String),
    kafka_partition UInt32,
    kafka_offset    UInt64,
    kafka_ts        Nullable(DateTime64(3, 'UTC')),
    ingested_at     DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (ts, consumer_id)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS txloom_analytics.events_kafka
(
    raw String
)
ENGINE = Kafka(txloom_kafka);

CREATE MATERIALIZED VIEW IF NOT EXISTS txloom_analytics.events_kafka_mv
TO txloom_analytics.events_raw
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
    raw,
    _topic                                                              AS kafka_topic,
    _partition                                                          AS kafka_partition,
    _offset                                                             AS kafka_offset,
    _timestamp_ms                                                       AS kafka_ts,
    now64(3)                                                            AS ingested_at
FROM txloom_analytics.events_kafka;
