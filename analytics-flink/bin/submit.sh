#!/usr/bin/env bash
# submit.sh <job> [extra flink-run args for Java jobs]
#
# job is one of:
#   clean-and-order | account-takeover | merchant-anomaly     (Java, -c <mainClass>)
#   velocity-features | card-testing | refund-abuse | sessions (Flink SQL, via the gateway)
#
# Java jobs run from the jar the flink-jobs-build container already placed
# in the flink-jobs-jar volume (mounted at /opt/flink/usrlib in
# flink-jobmanager) — run `docker compose ... up flink-jobs-build` first if
# you've changed job code since the last `up`.
#
# SQL jobs: 00_tables.sql is a template (see its header comment) — this
# script substitutes a job-unique Kafka consumer group and exactly-once
# transactional-id prefix, concatenates it with the job file, and pipes
# both to sql-client in gateway mode. Never submit a job .sql file on its
# own; it has no source/sink tables without 00_tables.sql prepended.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose-flink.yaml)

JOB="${1:?usage: submit.sh <job> [args...]}"
shift || true

case "$JOB" in
    clean-and-order)  MAIN_CLASS="dev.txloom.flink.CleanAndOrderJob" ;;
    account-takeover) MAIN_CLASS="dev.txloom.flink.AccountTakeoverJob" ;;
    merchant-anomaly) MAIN_CLASS="dev.txloom.flink.MerchantAnomalyJob" ;;
    velocity-features|card-testing|refund-abuse|sessions) MAIN_CLASS="" ;;
    *)
        echo "unknown job: $JOB" >&2
        echo "expected one of: clean-and-order account-takeover merchant-anomaly velocity-features card-testing refund-abuse sessions" >&2
        exit 1
        ;;
esac

if [[ -n "$MAIN_CLASS" ]]; then
    "${COMPOSE[@]}" exec flink-jobmanager \
        flink run -d -c "$MAIN_CLASS" /opt/flink/usrlib/txloom-flink-jobs.jar "$@"
else
    GROUP_ID="txloom-flink-sql-${JOB}"
    TXN_PREFIX="txloom-flink-alerts-${JOB}-"
    {
        sed -e "s/\${GROUP_ID}/${GROUP_ID}/" -e "s/\${TXN_PREFIX}/${TXN_PREFIX}/" \
            analytics-flink/jobs/sql/00_tables.sql
        cat "analytics-flink/jobs/sql/${JOB}.sql"
    } | "${COMPOSE[@]}" run --rm -T flink-sql-client \
        gateway --endpoint http://flink-sql-gateway:8083
fi
