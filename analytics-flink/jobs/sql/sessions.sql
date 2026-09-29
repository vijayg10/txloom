-- S4 sessions: per-consumer sessions via the SESSION windowing TVF
-- (gap 10 minutes) — count, spend, distinct channels, duration.

SET 'table.exec.state.ttl' = '30 min'; -- gap is 10 min; keep a margin for late-arriving continuations

CREATE TABLE sessions_sink (
    consumer_id      STRING,
    session_start    TIMESTAMP_LTZ(3),
    session_end      TIMESTAMP_LTZ(3),
    event_count      BIGINT,
    total_spend      DECIMAL(18, 4),
    channels         ARRAY<STRING>,
    duration_seconds BIGINT
) WITH (
    'connector' = 'kafka',
    'topic' = 'txloom-flink-sessions',
    'properties.bootstrap.servers' = 'kafka:29092',
    'format' = 'json',
    'json.timestamp-format.standard' = 'ISO-8601',
    'sink.delivery-guarantee' = 'exactly-once',
    'sink.transactional-id-prefix' = 'txloom-flink-sessions-sql-',
    'properties.transaction.timeout.ms' = '900000'
);

INSERT INTO sessions_sink
SELECT
    consumer_id,
    window_start AS session_start,
    window_end AS session_end,
    COUNT(*) AS event_count,
    SUM(amount) AS total_spend,
    ARRAY_AGG(DISTINCT channel) AS channels,
    TIMESTAMPDIFF(SECOND, window_start, window_end) AS duration_seconds
FROM SESSION(TABLE clean_events PARTITION BY consumer_id, DESCRIPTOR(ts), INTERVAL '10' MINUTES)
GROUP BY consumer_id, window_start, window_end;
