-- S3 refund-abuse: two independent detections, both into alerts_sink.
--
-- 1. Correlated pair: a refund that matches a prior payment (same consumer,
--    merchant, amount) within 5h — a time-interval join. Interval joins
--    need both sides' event-time watermarks; that's why this job declares
--    two separate copies of the clean-events table (own consumer groups —
--    see 00_tables.sql) rather than reusing one table object twice in the
--    join, which would otherwise put both scans in the same Kafka consumer
--    group and split partitions between them.
-- 2. Refund velocity: >= 2 refunds for one consumer within a trailing 24h
--    window, via the HOP windowing table-valued function (the modern
--    replacement for the legacy `GROUP BY HOP(...)` group-window syntax).
--    Deliberately a third, separate scan (own consumer group) rather than
--    reusing the join's refund side, for the same reason.

SET 'table.exec.state.ttl' = '6 h'; -- >= interval join's 5h bound, with slack

CREATE TABLE clean_events_refund_side (
    event_id    STRING,
    ts          TIMESTAMP_LTZ(3),
    `type`      STRING,
    consumer_id STRING,
    merchant_id STRING,
    amount      DECIMAL(18, 4),
    WATERMARK FOR ts AS ts - INTERVAL '5' SECOND
) WITH (
    'connector' = 'kafka',
    'topic' = 'txloom-flink-clean',
    'properties.bootstrap.servers' = 'kafka:29092',
    'properties.group.id' = 'txloom-flink-sql-refund-abuse-join-refund-side',
    'scan.startup.mode' = 'earliest-offset',
    'format' = 'json',
    'json.timestamp-format.standard' = 'ISO-8601',
    'json.ignore-parse-errors' = 'true'
);

CREATE TABLE clean_events_refund_velocity (
    event_id    STRING,
    ts          TIMESTAMP_LTZ(3),
    `type`      STRING,
    consumer_id STRING,
    WATERMARK FOR ts AS ts - INTERVAL '5' SECOND
) WITH (
    'connector' = 'kafka',
    'topic' = 'txloom-flink-clean',
    'properties.bootstrap.servers' = 'kafka:29092',
    'properties.group.id' = 'txloom-flink-sql-refund-abuse-velocity',
    'scan.startup.mode' = 'earliest-offset',
    'format' = 'json',
    'json.timestamp-format.standard' = 'ISO-8601',
    'json.ignore-parse-errors' = 'true'
);

-- Detection 1: correlated refund/payment pair --------------------------

INSERT INTO alerts_sink
SELECT
    MD5(CONCAT('refund_correlated|', p.consumer_id, '|', r.event_id)) AS alert_id,
    'refund_abuse' AS detector,
    'consumer' AS entity_type,
    p.consumer_id AS entity_id,
    p.ts AS window_start,
    r.ts AS window_end,
    CAST(1 AS DOUBLE) AS score,
    ARRAY[p.event_id, r.event_id] AS event_ids,
    CONCAT(
        '{"kind":"correlated_pair","merchant_id":"', COALESCE(p.merchant_id, ''),
        '","amount":', CAST(p.amount AS STRING), '}'
    ) AS details,
    CAST(NULL AS STRING) AS merchant_risk_tier,
    CURRENT_TIMESTAMP AS emitted_at
FROM clean_events AS p, clean_events_refund_side AS r
WHERE p.`type` = 'payment'
  AND r.`type` = 'refund'
  AND p.consumer_id = r.consumer_id
  AND p.merchant_id = r.merchant_id
  AND p.amount = r.amount
  AND r.ts BETWEEN p.ts AND p.ts + INTERVAL '5' HOUR;

-- Detection 2: refund velocity (>= 2 refunds / consumer / trailing 24h) -

INSERT INTO alerts_sink
SELECT
    MD5(CONCAT('refund_velocity|', consumer_id, '|', CAST(window_start AS STRING))) AS alert_id,
    'refund_abuse' AS detector,
    'consumer' AS entity_type,
    consumer_id AS entity_id,
    window_start,
    window_end,
    CAST(refund_count AS DOUBLE) AS score,
    event_ids,
    CONCAT('{"kind":"refund_velocity","refund_count":', CAST(refund_count AS STRING), '}') AS details,
    CAST(NULL AS STRING) AS merchant_risk_tier,
    CURRENT_TIMESTAMP AS emitted_at
FROM (
    SELECT
        consumer_id,
        window_start,
        window_end,
        COUNT(*) AS refund_count,
        ARRAY_AGG(event_id) AS event_ids
    FROM HOP(TABLE clean_events_refund_velocity, DESCRIPTOR(ts), INTERVAL '1' HOUR, INTERVAL '24' HOUR)
    WHERE `type` = 'refund'
    GROUP BY consumer_id, window_start, window_end
    HAVING COUNT(*) >= 2
);
