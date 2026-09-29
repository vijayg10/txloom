-- Volume and value per minute, last hour, from the events_1m rollup.
-- `amount` includes duplicate deliveries (see 03_rollups.sql); `events` is exact.

SELECT
    minute,
    type,
    status,
    channel,
    currency,
    sum(deliveries)              AS n_deliveries,
    uniqExactMerge(events)       AS n_events,
    sumMerge(amount)             AS total_amount,
    uniqMerge(consumers)         AS n_consumers
FROM txloom_analytics.events_1m
WHERE minute >= now() - INTERVAL 1 HOUR
GROUP BY minute, type, status, channel, currency
ORDER BY minute, type, status, channel, currency;

-- Throughput (events/sec) per minute, all types.
SELECT
    minute,
    uniqExactMerge(events) / 60 AS events_per_sec
FROM txloom_analytics.events_1m
WHERE minute >= now() - INTERVAL 1 HOUR
GROUP BY minute
ORDER BY minute;
