-- S1 velocity-features: per-event consumer/merchant velocity, via OVER
-- windows. Streaming version of analytics/queries/velocity.sql.
--
-- Flink SQL restriction: "for streaming queries, the OVER windows for all
-- aggregates [in one SELECT] must be identical" (different PARTITION BY /
-- range per column isn't allowed in a single SELECT list). consumer-5m,
-- consumer-1h and merchant-5m are three different window specs, so this
-- job computes each in its own query, then joins the three per-event
-- results back together on event_id. Each of the three scans of the clean
-- topic is a separate Kafka consumer group (see 00_tables.sql) — sharing
-- one group.id here would split partitions between the three scans
-- instead of each seeing the full stream.

SET 'table.exec.state.ttl' = '65 min'; -- >= widest OVER window (1h); also bounds the join state below

CREATE TABLE clean_events_1h (
    event_id    STRING,
    ts          TIMESTAMP_LTZ(3),
    consumer_id STRING,
    merchant_id STRING,
    amount      DECIMAL(18, 4),
    WATERMARK FOR ts AS ts - INTERVAL '5' SECOND
) WITH (
    'connector' = 'kafka',
    'topic' = 'txloom-flink-clean',
    'properties.bootstrap.servers' = 'kafka:29092',
    'properties.group.id' = 'txloom-flink-sql-velocity-features-1h',
    'scan.startup.mode' = 'earliest-offset',
    'format' = 'json',
    'json.timestamp-format.standard' = 'ISO-8601',
    'json.ignore-parse-errors' = 'true'
);

CREATE TABLE clean_events_merchant5m (
    event_id    STRING,
    ts          TIMESTAMP_LTZ(3),
    merchant_id STRING,
    WATERMARK FOR ts AS ts - INTERVAL '5' SECOND
) WITH (
    'connector' = 'kafka',
    'topic' = 'txloom-flink-clean',
    'properties.bootstrap.servers' = 'kafka:29092',
    'properties.group.id' = 'txloom-flink-sql-velocity-features-merchant5m',
    'scan.startup.mode' = 'earliest-offset',
    'format' = 'json',
    'json.timestamp-format.standard' = 'ISO-8601',
    'json.ignore-parse-errors' = 'true'
);

CREATE TABLE features_sink (
    event_id                        STRING,
    consumer_id                     STRING,
    merchant_id                     STRING,
    ts                              TIMESTAMP_LTZ(3),
    consumer_txn_count_5m           BIGINT,
    consumer_spend_5m               DECIMAL(18, 4),
    consumer_txn_count_1h           BIGINT,
    consumer_spend_1h               DECIMAL(18, 4),
    consumer_distinct_merchants_1h  BIGINT,
    merchant_txn_count_5m           BIGINT
) WITH (
    'connector' = 'kafka',
    'topic' = 'txloom-flink-features',
    'properties.bootstrap.servers' = 'kafka:29092',
    'format' = 'json',
    'json.timestamp-format.standard' = 'ISO-8601',
    'sink.delivery-guarantee' = 'exactly-once',
    'sink.transactional-id-prefix' = 'txloom-flink-features-sql-',
    'properties.transaction.timeout.ms' = '900000'
);

CREATE VIEW consumer_5m AS
SELECT
    event_id,
    consumer_id,
    merchant_id,
    ts,
    COUNT(*)     OVER w AS consumer_txn_count_5m,
    SUM(amount)  OVER w AS consumer_spend_5m
FROM clean_events
WINDOW w AS (
    PARTITION BY consumer_id
    ORDER BY ts
    RANGE BETWEEN INTERVAL '5' MINUTE PRECEDING AND CURRENT ROW
);

CREATE VIEW consumer_1h AS
SELECT
    event_id,
    COUNT(*)                    OVER w AS consumer_txn_count_1h,
    SUM(amount)                 OVER w AS consumer_spend_1h,
    COUNT(DISTINCT merchant_id) OVER w AS consumer_distinct_merchants_1h
FROM clean_events_1h
WINDOW w AS (
    PARTITION BY consumer_id
    ORDER BY ts
    RANGE BETWEEN INTERVAL '1' HOUR PRECEDING AND CURRENT ROW
);

CREATE VIEW merchant_5m AS
SELECT
    event_id,
    COUNT(*) OVER w AS merchant_txn_count_5m
FROM clean_events_merchant5m
WHERE merchant_id IS NOT NULL
WINDOW w AS (
    PARTITION BY merchant_id
    ORDER BY ts
    RANGE BETWEEN INTERVAL '5' MINUTE PRECEDING AND CURRENT ROW
);

INSERT INTO features_sink
SELECT
    a.event_id,
    a.consumer_id,
    a.merchant_id,
    a.ts,
    a.consumer_txn_count_5m,
    a.consumer_spend_5m,
    b.consumer_txn_count_1h,
    b.consumer_spend_1h,
    b.consumer_distinct_merchants_1h,
    c.merchant_txn_count_5m
FROM consumer_5m a
JOIN consumer_1h b ON a.event_id = b.event_id
LEFT JOIN merchant_5m c ON a.event_id = c.event_id;
