-- S2 card-testing: >= 3 payments under $10 from the same consumer within a
-- 10-minute window, via MATCH_RECOGNIZE. The WITHIN clause both encodes the
-- business rule and bounds the state Flink has to keep per open match.
--
-- event_ids in the unified alert schema is simplified to [first, last] of
-- the match rather than every matched event_id: Flink's MATCH_RECOGNIZE
-- aggregate support only covers per-variable aggregates (FIRST/LAST/COUNT/
-- SUM/...), not array collection, so a full id list would need a custom
-- UDAGG. First+last is enough to jump to the run in ClickHouse.

SET 'table.exec.state.ttl' = '30 min'; -- well beyond the 10-min pattern window

INSERT INTO alerts_sink
SELECT
    MD5(CONCAT('card_testing|', consumer_id, '|', CAST(window_start AS STRING))) AS alert_id,
    'card_testing' AS detector,
    'consumer' AS entity_type,
    consumer_id AS entity_id,
    window_start,
    window_end,
    CAST(hit_count AS DOUBLE) AS score,
    ARRAY[first_event_id, last_event_id] AS event_ids,
    CONCAT(
        '{"hit_count":', CAST(hit_count AS STRING),
        ',"min_amount":', CAST(min_amount AS STRING),
        ',"max_amount":', CAST(max_amount AS STRING), '}'
    ) AS details,
    CAST(NULL AS STRING) AS merchant_risk_tier,
    CURRENT_TIMESTAMP AS emitted_at
FROM clean_events
MATCH_RECOGNIZE (
    PARTITION BY consumer_id
    ORDER BY ts
    MEASURES
        FIRST(P.ts)       AS window_start,
        LAST(P.ts)        AS window_end,
        COUNT(P.event_id) AS hit_count,
        MIN(P.amount)     AS min_amount,
        MAX(P.amount)     AS max_amount,
        FIRST(P.event_id) AS first_event_id,
        LAST(P.event_id)  AS last_event_id
    ONE ROW PER MATCH
    AFTER MATCH SKIP PAST LAST ROW
    PATTERN (P{3,}) WITHIN INTERVAL '10' MINUTE
    DEFINE
        P AS P.`type` = 'payment' AND P.amount < 10
) AS T;
