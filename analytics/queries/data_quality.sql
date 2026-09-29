-- Data-quality checks on events_raw (every delivery, duplicates kept).
-- Label-based fraud/corruption queries are deferred until streamed labels
-- are published to Kafka (see analytics/README.md § Known gaps).

-- Duplicate deliveries.
SELECT
    count()                          AS deliveries,
    uniqExact(event_id)              AS distinct_events,
    deliveries - distinct_events     AS duplicate_deliveries
FROM txloom_analytics.events_raw;

-- Worst duplicated events.
SELECT event_id, count() AS copies, groupArray(delivery_id) AS delivery_ids
FROM txloom_analytics.events_raw
GROUP BY event_id
HAVING copies > 1
ORDER BY copies DESC
LIMIT 20;

-- Late arrivals: ingestion lag (ingested_at - ts) distribution, and events
-- arriving more than 60 s after their event time.
SELECT
    quantiles(0.5, 0.9, 0.99)(dateDiff('millisecond', ts, ingested_at)) AS lag_ms_p50_p90_p99,
    countIf(dateDiff('second', ts, ingested_at) > 60)                    AS late_over_60s,
    countIf(ts > ingested_at)                                            AS from_the_future
FROM txloom_analytics.events_raw;

-- Out-of-order: within each Kafka partition, events whose ts is earlier
-- than the previous message's ts.
SELECT
    kafka_topic,
    kafka_partition,
    countIf(ts < prev_ts) AS out_of_order,
    count()               AS total
FROM
(
    SELECT
        kafka_topic,
        kafka_partition,
        ts,
        lagInFrame(ts) OVER (PARTITION BY kafka_topic, kafka_partition ORDER BY kafka_offset
                             ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS prev_ts,
        row_number() OVER (PARTITION BY kafka_topic, kafka_partition ORDER BY kafka_offset) AS rn
    FROM txloom_analytics.events_raw
)
WHERE rn > 1
GROUP BY kafka_topic, kafka_partition
ORDER BY kafka_topic, kafka_partition;

-- Missing core fields (renamed/absent in the scenario's output mapping).
SELECT
    countIf(event_id = '')     AS missing_event_id,
    countIf(consumer_id = '')  AS missing_consumer_id,
    countIf(type = '')         AS missing_type,
    countIf(amount = 0)        AS zero_amount,
    count()                    AS total
FROM txloom_analytics.events_raw;
