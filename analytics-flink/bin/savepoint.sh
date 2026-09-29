#!/usr/bin/env bash
# savepoint.sh <job-id>: stop-with-savepoint (LABS.md #6).
# The job stops cleanly after the savepoint completes; resume it with resume.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

JOB_ID="${1:?usage: savepoint.sh <job-id>}"

docker compose -f docker-compose.yml -f docker-compose-flink.yaml exec flink-jobmanager \
    flink stop -p s3://flink-state/savepoints "$JOB_ID"
