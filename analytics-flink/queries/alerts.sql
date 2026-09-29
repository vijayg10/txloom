-- Alert triage: recent alerts by detector/entity, with score. FINAL because
-- alerts is a ReplacingMergeTree (alert_id can be re-emitted on replay) and
-- background merges may not have collapsed duplicates yet.

SELECT
    emitted_at,
    detector,
    entity_type,
    entity_id,
    round(score, 4)         AS score,
    window_start,
    window_end,
    length(event_ids)       AS n_events,
    merchant_risk_tier
FROM txloom_flink.alerts FINAL
WHERE emitted_at >= now() - INTERVAL 1 HOUR
ORDER BY emitted_at DESC
LIMIT 100;

-- Highest-score alert per entity in the last 24h (worst offenders).
SELECT
    entity_type,
    entity_id,
    argMax(detector, score) AS top_detector,
    max(score)               AS max_score,
    count()                  AS n_alerts
FROM txloom_flink.alerts FINAL
WHERE emitted_at >= now() - INTERVAL 24 HOUR
GROUP BY entity_type, entity_id
ORDER BY max_score DESC
LIMIT 50;
