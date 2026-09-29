-- Feature lookups for a given consumer (S1 velocity-features.sql output).
-- Swap the consumer_id literal for whichever id you're inspecting.

SELECT
    event_id,
    ts,
    merchant_id,
    consumer_txn_count_5m,
    consumer_spend_5m,
    consumer_txn_count_1h,
    consumer_spend_1h,
    consumer_distinct_merchants_1h,
    merchant_txn_count_5m
FROM txloom_flink.features
WHERE consumer_id = 'cons_1'
ORDER BY ts DESC
LIMIT 50;

-- Consumers with the highest 1h velocity right now — same intent as
-- analytics/queries/velocity.sql's "most active consumers", but reading
-- Flink's precomputed streaming features instead of recomputing OVER windows.
SELECT
    consumer_id,
    argMax(consumer_txn_count_1h, ts)          AS txn_count_1h,
    argMax(consumer_spend_1h, ts)              AS spend_1h,
    argMax(consumer_distinct_merchants_1h, ts) AS distinct_merchants_1h
FROM txloom_flink.features
WHERE ts >= now() - INTERVAL 1 HOUR
GROUP BY consumer_id
ORDER BY txn_count_1h DESC
LIMIT 20;
