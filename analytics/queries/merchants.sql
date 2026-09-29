-- Top merchants by volume over the last 24h, from the merchant_1h rollup.

SELECT
    merchant_id,
    anyLast(merchant_name)                                   AS merchant_name,
    currency,
    uniqExactMerge(events)                                   AS n_events,
    sumMerge(amount)                                         AS total_amount,
    uniqExactIfMerge(declined)                               AS n_declined,
    round(n_declined / n_events, 4)                          AS decline_rate,
    uniqMerge(consumers)                                     AS n_consumers
FROM txloom_analytics.merchant_1h
WHERE hour >= now() - INTERVAL 24 HOUR
GROUP BY merchant_id, currency
ORDER BY n_events DESC
LIMIT 20;

-- Decline rate by channel and event type (exact, from the dedup view).
SELECT
    channel,
    type,
    count()                                AS events,
    countIf(status = 'declined')           AS declined,
    round(declined / events, 4)            AS decline_rate
FROM txloom_analytics.events
WHERE ts >= now() - INTERVAL 24 HOUR
GROUP BY channel, type
ORDER BY decline_rate DESC;
