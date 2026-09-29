-- Incremental rollups, maintained on every insert into events_raw.
--
-- Materialized views only see the inserted block, so they cannot dedup
-- across deliveries: event counts use uniqExact(event_id) and stay exact,
-- but amount sums include duplicate deliveries. For exact money totals,
-- query the `events` view instead.

-- Per-minute volume/value by type, status, channel, currency ---------------

CREATE TABLE IF NOT EXISTS txloom_analytics.events_1m
(
    minute      DateTime('UTC'),
    type        LowCardinality(String),
    status      LowCardinality(String),
    channel     LowCardinality(String),
    currency    LowCardinality(String),
    deliveries  SimpleAggregateFunction(sum, UInt64),
    events      AggregateFunction(uniqExact, String),
    amount      AggregateFunction(sum, Decimal64(4)),
    consumers   AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMMDD(minute)
ORDER BY (minute, type, status, channel, currency)
TTL minute + INTERVAL 90 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS txloom_analytics.events_1m_mv
TO txloom_analytics.events_1m
AS
SELECT
    toStartOfMinute(ts)       AS minute,
    type,
    status,
    channel,
    currency,
    count()                   AS deliveries,
    uniqExactState(event_id)  AS events,
    sumState(amount)          AS amount,
    uniqState(consumer_id)    AS consumers
FROM txloom_analytics.events_raw
GROUP BY minute, type, status, channel, currency;

-- Per-hour merchant stats ---------------------------------------------------

CREATE TABLE IF NOT EXISTS txloom_analytics.merchant_1h
(
    hour           DateTime('UTC'),
    merchant_id    String,
    currency       LowCardinality(String),
    merchant_name  SimpleAggregateFunction(anyLast, Nullable(String)),
    events         AggregateFunction(uniqExact, String),
    declined       AggregateFunction(uniqExactIf, String, UInt8),
    amount         AggregateFunction(sum, Decimal64(4)),
    consumers      AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, merchant_id, currency)
TTL hour + INTERVAL 90 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS txloom_analytics.merchant_1h_mv
TO txloom_analytics.merchant_1h
AS
SELECT
    toStartOfHour(ts)                                     AS hour,
    assumeNotNull(merchant_id)                            AS merchant_id,
    currency,
    anyLast(merchant_name)                                AS merchant_name,
    uniqExactState(event_id)                              AS events,
    uniqExactIfState(event_id, status = 'declined')       AS declined,
    sumState(amount)                                      AS amount,
    uniqState(consumer_id)                                AS consumers
FROM txloom_analytics.events_raw
WHERE merchant_id IS NOT NULL
GROUP BY hour, merchant_id, currency;
