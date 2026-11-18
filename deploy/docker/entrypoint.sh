#!/bin/sh
# Runs the API and the worker in one container. If either exits, stop the
# other and exit non-zero so the orchestrator restarts the whole pod.
set -u

node --import tsx apps/api/src/server.ts & api=$!
node --import tsx apps/worker/src/index.ts & worker=$!

stop() { kill -TERM "$api" "$worker" 2>/dev/null; }
trap 'stop; wait; exit 0' TERM INT

# `wait -n` is not POSIX sh; poll instead.
while kill -0 "$api" 2>/dev/null && kill -0 "$worker" 2>/dev/null; do
  sleep 2
done
echo "txloom: api or worker exited, shutting down" >&2
stop
wait
exit 1
