-- Counts per detector over time — is a detector noisy, silent, or firing in
-- bursts (e.g. card-testing's MATCH_RECOGNIZE window closing all at once).

SELECT
    toStartOfMinute(emitted_at) AS minute,
    detector,
    uniqExact(alert_id)         AS alerts
FROM txloom_flink.alerts FINAL
WHERE emitted_at >= now() - INTERVAL 1 HOUR
GROUP BY minute, detector
ORDER BY minute, detector;

-- Totals per detector, last 24h.
SELECT
    detector,
    uniqExact(alert_id)         AS alerts,
    uniqExact(entity_id)        AS distinct_entities,
    round(avg(score), 4)        AS avg_score
FROM txloom_flink.alerts FINAL
WHERE emitted_at >= now() - INTERVAL 24 HOUR
GROUP BY detector
ORDER BY alerts DESC;
