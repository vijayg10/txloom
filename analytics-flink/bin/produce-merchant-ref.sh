#!/usr/bin/env bash
# produce-merchant-ref.sh <merchant_id> <risk_tier> [category]
#
# Hand-publishes one record to the compacted txloom-flink-merchant-ref
# topic, which J3 (merchant-anomaly) broadcasts — LABS.md #9: publish a
# risk tier and watch merchant_anomaly alerts get enriched with it without
# redeploying the job.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

MERCHANT_ID="${1:?usage: produce-merchant-ref.sh <merchant_id> <risk_tier> [category]}"
RISK_TIER="${2:?usage: produce-merchant-ref.sh <merchant_id> <risk_tier> [category]}"
CATEGORY="${3:-unknown}"
UPDATED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

JSON=$(printf '{"merchant_id":"%s","risk_tier":"%s","category":"%s","updated_at":"%s"}' \
    "$MERCHANT_ID" "$RISK_TIER" "$CATEGORY" "$UPDATED_AT")

echo "${MERCHANT_ID}:${JSON}" | docker compose -f docker-compose.yml -f docker-compose-flink.yaml exec -T kafka \
    /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 \
    --topic txloom-flink-merchant-ref \
    --property "parse.key=true" --property "key.separator=:"

echo "published merchant-ref for ${MERCHANT_ID}: ${JSON}"
