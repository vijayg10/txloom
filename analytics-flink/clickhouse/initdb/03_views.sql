-- Per-minute reconciliation between the raw stream and J1's cleaned output —
-- the view PLAN.md's "raw-vs-Flink comparison tables" refers to. A plain
-- VIEW (not materialized): the underlying tables are small enough at demo
-- volume to aggregate on read, and this way the columns/logic can change
-- without a backfill.
--
-- `duplicates_dropped` compares distinct event_ids seen in the raw stream to
-- rows landed in events_clean for the same minute — not exact per-row lineage
-- (J1's dedup state can span minute boundaries), but close enough to see
-- duplicate injection work. `late` is read straight from quality (kind='late')
-- rather than inferred, since J1 already makes that call authoritatively.

CREATE VIEW IF NOT EXISTS txloom_flink.raw_vs_clean
AS
SELECT
    minute,
    raw_deliveries,
    raw_distinct_events,
    clean_events,
    raw_distinct_events - clean_events AS duplicates_dropped,
    late_events
FROM
(
    SELECT
        toStartOfMinute(ts)      AS minute,
        count()                  AS raw_deliveries,
        uniqExact(event_id)      AS raw_distinct_events
    FROM txloom_flink.events_raw
    GROUP BY minute
) AS raw
FULL JOIN
(
    SELECT
        toStartOfMinute(ts) AS minute,
        uniqExact(event_id) AS clean_events
    FROM txloom_flink.events_clean
    GROUP BY minute
) AS clean
USING (minute)
FULL JOIN
(
    SELECT
        toStartOfMinute(ts)  AS minute,
        uniqExact(event_id)  AS late_events
    FROM txloom_flink.quality
    WHERE kind = 'late'
    GROUP BY minute
) AS late
USING (minute)
ORDER BY minute;
