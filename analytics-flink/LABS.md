# Labs: guided experiments with the Flink stack

Prerequisites: the stack is up (`docker compose -f docker-compose.yml -f
docker-compose-flink.yaml --profile demo-brokers up -d`) and at least
`clean-and-order` is submitted (`analytics-flink/bin/submit.sh
clean-and-order`). Each lab notes which other jobs it needs.

Record what you actually observe as you go — timings, panel screenshots,
surprising numbers — the same way `analytics/README.md`'s "Validated"
section does. This file describes the exercises; it doesn't claim results
that were never run against a live cluster (see `README.md`'s "Verified so
far").

## 1. First run

Submit `clean-and-order`, launch a TxLoom scenario streaming into
`txloom-events`, and watch the Flink Web UI (http://localhost:8081): the
job graph, records in/out per operator, and `currentInputWatermark`
climbing on each subtask. Compare `txloom_flink.events_raw` and
`events_clean` row counts in ClickHouse (`/play` at http://localhost:8124,
or `queries/raw_vs_clean.sql`) — they should track closely with no
duplicate injection.

## 2. Dedup & exactly-once

Run a scenario with duplicate delivery injection enabled. Query
`txloom_flink.quality WHERE kind = 'duplicate'` — those event_ids should
be absent from `events_clean`. Note the ~10s gap between an event being
processed and appearing in ClickHouse: the transactional sink only commits
on checkpoint (`execution.checkpointing.interval: 10s` in
`flink/config.yaml`), and ClickHouse's Kafka engine tables only read
`read_committed`.

## 3. Late & out-of-order data

Enable late-arrival / out-of-order imperfections in the scenario. Tune
`--watermark-bound-seconds` on `clean-and-order` (resubmit, or `resume.sh`
from a savepoint with a new value — see lab 6) and watch
`txloom_flink.quality WHERE kind = 'late'` grow or shrink as the bound
changes. A tighter bound flags more events as late (they arrive further
behind a faster-moving watermark); a looser bound admits more of them to
`events_clean` but delays how quickly the watermark — and everything
downstream that depends on it — advances.

## 4. Idle partitions

`txloom-events` may only have 1 partition if it existed before
`flink-kafka-init` ran (see README's Troubleshooting). With
`parallelism.default: 2` on a 1-partition source, one source subtask sits
idle forever and — without idleness detection — never contributes a
watermark, so the *operator's* watermark (the minimum across subtasks)
never advances past `Long.MIN_VALUE`, and nothing downstream that depends
on it (late detection, windows) ever fires. Resubmit `clean-and-order`
with `--idleness-seconds 0` to disable idleness handling and reproduce the
stall (watch `currentInputWatermark` on the idle subtask in the Web UI —
it never leaves its initial value). Then resubmit with the default
(`--idleness-seconds 60`, or omit the flag) and watch it recover: after
60s of no records, Flink marks the idle subtask's watermark as advancing
with the others instead of holding the minimum back.

## 5. Failover

With `clean-and-order` running and a scenario streaming, `docker kill` a
TaskManager (`docker compose -f docker-compose.yml -f
docker-compose-flink.yaml kill flink-taskmanager-1`). The job restarts
(`restart-strategy.type: exponential-delay` in `flink/config.yaml`) from
the last checkpoint once a TaskManager is available again — `docker
compose ... up -d flink-taskmanager-1` restarts the killed one. Verify no
loss/duplication downstream: distinct `event_id` counts in `events_clean`
before and after the kill should match what was actually produced, and no
`quality` duplicates should appear that weren't injected.

## 6. Savepoint, rescale, resume

```bash
analytics-flink/bin/savepoint.sh <job-id>          # from the Web UI or `flink list`
analytics-flink/bin/resume.sh clean-and-order s3://flink-state/savepoints/savepoint-xxx -p 4
```

Inspect the savepoint's files via the MinIO console
(http://localhost:9101, bucket `flink-state`). Then try changing
`CleanAndOrderJob`'s logic in a way that changes an operator's state shape
(e.g. adding a new keyed state field) — resuming from an old savepoint
against the changed job either fails fast (mismatched state) or silently
starts the new field empty, depending on what changed; compare against
resuming with an unrelated code change (e.g. a log line), which restores
cleanly. This is what operator UIDs (set via `.uid(...)` throughout the
jobs) are for: they pin each operator's state to a stable identity across
redeploys instead of Flink inferring it from the job graph shape.

## 7. Fraud scenarios

Run scenario templates for card testing, account takeover, and refund
abuse (`mcp__txloom__list_templates` / the UI's template picker). Submit
`velocity-features`, `card-testing`, `refund-abuse`, `sessions`,
`account-takeover`, and `merchant-anomaly` (or just `submit-all.sh`).
Watch `txloom_flink.alerts` fill in — `queries/alerts.sql` and the
Detections dashboard's "latest alerts" panel. Tune a detector's threshold
via its `--param` (Java jobs) or the `SET` block at the top of its `.sql`
file, resubmit, and see the alert rate change.

## 8. Pattern matching two ways

Compare `card-testing.sql`'s `MATCH_RECOGNIZE` pattern
(`PATTERN (P{3,}) WITHIN INTERVAL '10' MINUTE`) against
`AccountTakeoverJob.AccountTakeover`'s hand-rolled equivalent (an open
`DrainWindow` in keyed state plus an event-time timer). Same shape of
problem — "N qualifying events within a time bound" — solved once
declaratively and once imperatively; note what each approach makes easy
(SQL: the pattern itself is one line; Java: arbitrary per-event logic like
the unseen-counterparty check and the EWMA deviation score, which
`MATCH_RECOGNIZE`'s `DEFINE`/`MEASURES` aggregate support couldn't
express).

## 9. Broadcast state

```bash
analytics-flink/bin/produce-merchant-ref.sh mch_123 high fraud_prone
```

With `merchant-anomaly` already running, publish a risk tier for a
merchant that's currently generating anomalies (or wait for one to). New
`merchant_anomaly` alerts for that merchant should carry
`merchant_risk_tier = "high"` immediately — no redeploy. This is the
broadcast-state pattern: `MerchantAnomalyJob` connects the windowed-stats
stream to a broadcast stream of `txloom-flink-merchant-ref` records, and
every parallel subtask keeps its own full copy of the broadcast state
(`ctx.getBroadcastState(...)`), updated the moment a new record arrives
regardless of which partition/key it's related to.

## 10. State & TTL

Watch RocksDB state size and checkpoint size climb in the Flink Runtime
dashboard as a scenario streams for a while (`clean-and-order`'s
per-`event_id` dedup state, `account-takeover`'s per-consumer known
counterparties). Change `clean-and-order`'s `--state-ttl-hours` down to
something small (e.g. `0.05` ≈ 3 min) and resubmit — state size should
plateau sooner as old entries expire, at the cost of the same `event_id`
recurring outside the TTL window no longer being recognized as a
duplicate. Also observe `MerchantAnomalyJob`'s EWMA baseline itself
drifting toward a sustained anomaly over many windows (see the job's
class-level Javadoc) — a concrete example of why "the baseline updates on
every window, not just normal ones" is a real trade-off, not just a
caveat in a comment.

## 11. Backpressure

Raise the scenario's target TPS well above what `clean-and-order` (2
slots × 2 TaskManagers) can sustain, or artificially throttle it by
resubmitting with a lower parallelism (`flink run -p 1 ...`, via
`bin/submit.sh clean-and-order -p 1`). Watch the Web UI's backpressure
indicator turn from OK to high on the source, and the Flink Runtime
dashboard's busy/backpressured-time panels rise. Kafka consumer lag
(same dashboard) should climb in step. Ease off the TPS or restore
parallelism and watch both recover.
