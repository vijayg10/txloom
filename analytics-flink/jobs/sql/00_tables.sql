-- Template, not directly runnable on its own: bin/submit.sh substitutes
-- ${GROUP_ID} and ${TXN_PREFIX} with values unique to the job being
-- submitted, then concatenates this file with the job file and pipes both
-- to sql-client (Flink SQL has no native `INCLUDE`).
--
-- Why these must be unique per job (never hardcode and reuse across jobs):
-- every job that reads txloom-flink-clean is an independent Kafka consumer
-- group. If two jobs shared one group.id, Kafka would split the topic's
-- partitions between them and each job would silently see only part of
-- the stream. Likewise every exactly-once Kafka sink needs a
-- transactional-id-prefix that's unique across the whole cluster, stable
-- across restarts of *that* job — reuse it in a second job and the two
-- producers fence (abort) each other's transactions.

CREATE TABLE clean_events (
    event_id        STRING,
    delivery_id     STRING,
    ts              TIMESTAMP_LTZ(3),
    `type`          STRING,
    status          STRING,
    amount          DECIMAL(18, 4),
    currency        STRING,
    consumer_id     STRING,
    consumer_name   STRING,
    merchant_id     STRING,
    merchant_name   STRING,
    counterparty_id STRING,
    channel         STRING,
    partition_no    INT,
    -- Small bound (vs J1's 30s): by the time an event reaches this topic
    -- it has already been through J1's clean-and-order watermark logic.
    WATERMARK FOR ts AS ts - INTERVAL '5' SECOND
) WITH (
    'connector' = 'kafka',
    'topic' = 'txloom-flink-clean',
    'properties.bootstrap.servers' = 'kafka:29092',
    'properties.group.id' = '${GROUP_ID}',
    'scan.startup.mode' = 'earliest-offset',
    'format' = 'json',
    'json.timestamp-format.standard' = 'ISO-8601',
    'json.ignore-parse-errors' = 'true'
);

-- Unified alert schema (see PLAN.md). `details` is a raw JSON string rather
-- than a nested ROW so each detector can carry its own fields without a
-- shared schema; ClickHouse stores it as-is and queries use JSONExtract*.
CREATE TABLE alerts_sink (
    alert_id           STRING,
    detector           STRING,
    entity_type        STRING,
    entity_id          STRING,
    window_start       TIMESTAMP_LTZ(3),
    window_end         TIMESTAMP_LTZ(3),
    score              DOUBLE,
    event_ids          ARRAY<STRING>,
    details            STRING,
    merchant_risk_tier STRING,
    emitted_at         TIMESTAMP_LTZ(3)
) WITH (
    'connector' = 'kafka',
    'topic' = 'txloom-flink-alerts',
    'properties.bootstrap.servers' = 'kafka:29092',
    'format' = 'json',
    'json.timestamp-format.standard' = 'ISO-8601',
    'sink.delivery-guarantee' = 'exactly-once',
    'sink.transactional-id-prefix' = '${TXN_PREFIX}',
    'properties.transaction.timeout.ms' = '900000'
);
