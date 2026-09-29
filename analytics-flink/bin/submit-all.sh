#!/usr/bin/env bash
# submit-all.sh: submit every job in dependency order.
#
# J1 (clean-and-order) is a gate — every other job reads its output topic
# (txloom-flink-clean), so it's submitted first with a pause to let it
# reach RUNNING before the rest start consuming from a topic nothing is
# producing to yet.
set -euo pipefail

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$BIN_DIR/submit.sh" clean-and-order
echo "waiting for clean-and-order to come up before starting downstream jobs..."
sleep 15

for job in velocity-features card-testing refund-abuse sessions account-takeover merchant-anomaly; do
    echo "submitting $job..."
    "$BIN_DIR/submit.sh" "$job"
done

echo "all jobs submitted — check the Web UI at http://localhost:8081"
