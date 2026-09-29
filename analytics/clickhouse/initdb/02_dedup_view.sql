-- Clean, one-row-per-event view over events_raw. Keeps the first delivery
-- (lowest ingested_at, then Kafka offset) of each event_id, so injected
-- duplicate deliveries don't inflate metrics. events_raw itself keeps every
-- delivery for data-quality analysis (queries/data_quality.sql).

CREATE VIEW IF NOT EXISTS txloom_analytics.events
AS
SELECT *
FROM txloom_analytics.events_raw
ORDER BY event_id, ingested_at, kafka_offset
LIMIT 1 BY event_id;
