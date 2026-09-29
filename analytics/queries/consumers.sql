-- Consumer spend over the last 24h (exact, from the dedup view).

SELECT
    consumer_id,
    any(consumer_name)                           AS consumer_name,
    currency,
    count()                                      AS events,
    sumIf(amount, status = 'approved')           AS approved_amount,
    countIf(status = 'declined')                 AS declined,
    uniqExact(merchant_id)                       AS distinct_merchants,
    min(ts)                                      AS first_seen,
    max(ts)                                      AS last_seen
FROM txloom_analytics.events
WHERE ts >= now() - INTERVAL 24 HOUR
GROUP BY consumer_id, currency
ORDER BY approved_amount DESC
LIMIT 50;

-- Spend distribution: amount quantiles by event type.
SELECT
    type,
    currency,
    count()                                             AS events,
    quantiles(0.5, 0.9, 0.99)(toFloat64(amount))        AS p50_p90_p99,
    max(amount)                                         AS max_amount
FROM txloom_analytics.events
WHERE ts >= now() - INTERVAL 24 HOUR
GROUP BY type, currency
ORDER BY events DESC;
