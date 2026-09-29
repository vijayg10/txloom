-- Real-time velocity features per consumer — the kind of signals a fraud
-- pipeline would compute. Live stream `ts` is wall-clock, so now()-relative
-- windows work.

-- Consumers with the most activity in the last 5 minutes.
SELECT
    consumer_id,
    count()                         AS txn_5m,
    sum(amount)                     AS amount_5m,
    uniqExact(merchant_id)          AS merchants_5m,
    countIf(status = 'declined')    AS declines_5m
FROM txloom_analytics.events
WHERE ts >= now() - INTERVAL 5 MINUTE
GROUP BY consumer_id
ORDER BY txn_5m DESC
LIMIT 20;

-- Sliding windows per event: how many txns / how much spend the same
-- consumer had in the preceding 5 min and 1 h (inclusive of this event).
SELECT
    event_id,
    consumer_id,
    ts,
    amount,
    count() OVER w5m    AS txn_prev_5m,
    sum(amount) OVER w5m AS amount_prev_5m,
    count() OVER w1h    AS txn_prev_1h
FROM txloom_analytics.events
WHERE ts >= now() - INTERVAL 2 HOUR
WINDOW
    w5m AS (PARTITION BY consumer_id ORDER BY toUnixTimestamp(ts)
            RANGE BETWEEN 300 PRECEDING AND CURRENT ROW),
    w1h AS (PARTITION BY consumer_id ORDER BY toUnixTimestamp(ts)
            RANGE BETWEEN 3600 PRECEDING AND CURRENT ROW)
ORDER BY txn_prev_5m DESC, ts DESC
LIMIT 50;
