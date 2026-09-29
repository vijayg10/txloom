-- Reconciliation against the raw_vs_clean view (03_views.sql): what J1
-- removed/held back per minute, over the last hour.

SELECT
    minute,
    raw_deliveries,
    raw_distinct_events,
    clean_events,
    duplicates_dropped,
    late_events
FROM txloom_flink.raw_vs_clean
WHERE minute >= now() - INTERVAL 1 HOUR
ORDER BY minute;

-- Totals: does clean + duplicates_dropped roughly track raw_distinct_events?
-- (Not exact — J1's dedup state and late-arrival handling can straddle
-- minute boundaries.)
SELECT
    sum(raw_distinct_events)  AS raw_distinct_events,
    sum(clean_events)         AS clean_events,
    sum(duplicates_dropped)   AS duplicates_dropped,
    sum(late_events)          AS late_events
FROM txloom_flink.raw_vs_clean
WHERE minute >= now() - INTERVAL 24 HOUR;
