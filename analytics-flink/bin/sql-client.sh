#!/usr/bin/env bash
# sql-client.sh: interactive Flink SQL client, connected to the gateway.
# Handy for ad hoc exploration (`SELECT * FROM ...`) — for submitting one
# of the actual jobs, use submit.sh instead (it handles the
# 00_tables.sql templating this shell doesn't).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

docker compose -f docker-compose.yml -f docker-compose-flink.yaml run --rm flink-sql-client
