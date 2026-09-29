#!/usr/bin/env bash
# resume.sh <job> <savepoint-path> [extra flink-run args]: resume a Java job
# from a savepoint (LABS.md #6), e.g. after savepoint.sh printed its path,
# or to change parallelism: resume.sh clean-and-order s3://flink-state/savepoints/savepoint-xxx -p 4
#
# SQL jobs aren't covered here — resume one by re-submitting via submit.sh
# with `SET 'execution.savepoint.path' = '<path>';` added before its INSERT
# in the SQL client.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose-flink.yaml)

JOB="${1:?usage: resume.sh <job> <savepoint-path> [args...]}"
SAVEPOINT_PATH="${2:?usage: resume.sh <job> <savepoint-path> [args...]}"
shift 2

case "$JOB" in
    clean-and-order)  MAIN_CLASS="dev.txloom.flink.CleanAndOrderJob" ;;
    account-takeover) MAIN_CLASS="dev.txloom.flink.AccountTakeoverJob" ;;
    merchant-anomaly) MAIN_CLASS="dev.txloom.flink.MerchantAnomalyJob" ;;
    *)
        echo "unknown/unsupported job for resume.sh: $JOB (Java jobs only)" >&2
        exit 1
        ;;
esac

"${COMPOSE[@]}" exec flink-jobmanager \
    flink run -s "$SAVEPOINT_PATH" -d -c "$MAIN_CLASS" /opt/flink/usrlib/txloom-flink-jobs.jar "$@"
