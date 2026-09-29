-- Breakdown of duplicate/late/clock_skew counts over time (J1's quality
-- side outputs, txloom-flink-quality).

SELECT
    toStartOfMinute(ts) AS minute,
    kind,
    count()             AS events
FROM txloom_flink.quality
WHERE ts >= now() - INTERVAL 1 HOUR
GROUP BY minute, kind
ORDER BY minute, kind;

-- Totals + lateness/skew magnitude, last 24h.
SELECT
    kind,
    count()                                          AS events,
    quantiles(0.5, 0.9, 0.99)(lateness_ms)            AS lateness_ms_p50_p90_p99,
    quantiles(0.5, 0.9, 0.99)(skew_ms)                AS skew_ms_p50_p90_p99
FROM txloom_flink.quality
WHERE ts >= now() - INTERVAL 24 HOUR
GROUP BY kind
ORDER BY events DESC;
