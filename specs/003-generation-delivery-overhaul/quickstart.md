# Quickstart: Validating the Generation-to-Delivery Overhaul

**Feature**: `003-generation-delivery-overhaul` | **Plan**: [plan.md](./plan.md)

These are runnable checks, one block per user story. Each one proves its story end to end
against the real stack. The automated versions live in the contract, integration, golden-master
and e2e suites; this page is for manual verification and demos.

## Setup

```bash
pnpm install
docker compose --profile demo-brokers up -d --build     # api, worker, mysql, redis, kafka
pnpm test && pnpm test:integration                        # unit/contract/component + Testcontainers
```

**Prerequisites**: Docker with Compose v2; ports 3000 and 9092 free. No configuration file
edits are needed. `local-kafka` is registered automatically (FR-013).

For a **UI-only prototype** with mocked data, which needs no stack:
`VITE_TXLOOM_MOCK=1 pnpm --filter @txloom/web dev`.

---

## US8 / SC-001: two-click first run (smoke test of the whole path)

1. On an empty install, open `http://localhost:3000`. The **first-run card** is shown.
2. Click **Stream a sample UPI world to Kafka**, then **Start**.
3. Watch the events arrive:
   ```bash
   docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
     --bootstrap-server kafka:29092 --topic txloom.events --max-messages 5
   ```
4. **Expected**: the run page shows the phases `generating → live` and moves to the **Live
   stream** tab by itself, with the chip `→ local-kafka / txloom.events`.

## US1: authenticated Kafka (SASL_SSL + SCRAM + CA)

```bash
pnpm test:integration --project integration -t "kafka sasl_ssl scram"   # Testcontainers broker with SCRAM-SHA-512 + self-signed CA
```

To check it by hand in the UI:

1. Go to **Connections → Add connection → Kafka**. Choose **SASL_SSL**: the SASL mechanism,
   username, password and CA fields appear.
2. Click **Test**; it must succeed **before Save** is pressed. Then break the password and
   test again. **Expected**: the result names stage `auth` and what to check.
3. Save, reopen the connection, and confirm the password field is empty
   (`has_credentials: true`).
4. Type `localhost:9092` as the bootstrap server. **Expected**: the `localhost` warning
   mentions `kafka:29092`.

## US2 / SC-004: delivered data matches the answer key

```bash
pnpm --filter @txloom/e2e test:e2e --grep @answer-key
```

This launches `apps/e2e/fixtures/imperfections-all.json`, which has one file sink and one Kafka
sink, all four imperfections, and `replay_history: true`. For each sink it then checks:

- every `duplicate`, `late`, `out_of_order` and `clock_skew` label has a matching delivered
  record:
  - duplicates share an `event_id` but carry distinct `delivery_id`s;
  - late records have `delivered_at > ts`, and their position comes after records with an
    earlier `delivered_at`;
  - skewed records have `ts ≠ truth ts` by exactly the offset;
- there are **0** delivered records without truth, and **0** records labeled delivered that
  are missing;
- with a webhook pointed at an endpoint that returns 500, every failed event appears exactly
  once with `delivery_outcome: dropped`.

## US3: reliability at scale

```bash
pnpm bench:reference          # 200k consumers × 5k merchants × 90 days, all typologies + imperfections (SC-006/007)
pnpm bench:memory-flatness    # 30d vs 90d peak RSS per thread, must be ≤ +10% (SC-007)
pnpm bench:refund-scaling     # 2k vs 4k consumers with refund abuse, ≤ 2.5× (SC-008)
pnpm test:integration -t "stream restart|two streams|tiny run|partition retry"
```

To check it by hand: start a stream, **Stop** it, then **Start** it again. **Expected**: the
offsets on the topic keep growing (SC-011), and `GET /runs/:id/stream/sessions` shows sessions
1 and 2.

## US4 / SC-005: reproducibility and engine versioning

```bash
pnpm test -t "golden-master"                  # golden master pinned to the current ENGINE_VERSION
pnpm --filter @txloom/e2e test:e2e --grep @us4  # determinism double-run (byte-identical)
```

Also check by hand:

- Seeds `"1"` and `"4294967297"` (2^32 + 1) produce **different** truth files.
- `POST /runs/<v1-run>/regenerate` returns `409 engine_version_mismatch`, and the message
  names both versions.

## US5 / SC-002: Launch panel

1. Open a scenario and click **Launch**. The panel lists every spec sink. The Kafka sink offers
   `local-kafka` plus **New connection…**, with its topic prefilled.
2. The estimate line shows the number of history events and the expected generation time.
3. Choose **New connection…**, then save. **Expected**: the panel keeps every other field, and
   the new connection is selected.
4. Launch. Reopen the panel. **Expected**: the same destinations are preselected, so
   relaunching takes one click.
5. Under **Advanced → Replay history to broker**, launch again. **Expected**: the run shows a
   *replaying* phase with its own progress, and live starts only after it finishes.

## US6 / SC-012: the live world continues history

```bash
pnpm test -t "live continuity"     # golden master: history days 0..D-1 + live days D.. == one uninterrupted simulation
```

To check it by hand on a live stream with fraud typologies:

- the first live `ts` is at or after the end of the history window;
- `income_credit` and fraud-labeled events appear on the label topic;
- the weekday/weekend ratio is within 10% of the history's.

## US7 / SC-010, SC-013: honest stream health

```bash
pnpm bench:kafka                  # 1,000 TPS for 30 min via a real stream session; ≥99% of 1-s windows within ±5%
pnpm test:integration -t "webhook hang|rabbitmq blocked|kafka throttled"
```

**Expected**:

- a hanging webhook never drives the achieved rate to 0;
- `sink_lag` and `backpressure` respond within 2 s;
- after sustained failure the stream enters `error`, and stays there until it is stopped.

## US9: realism and exports with labels

```bash
pnpm test -t "ato stagger|dormancy|daily curve|export merge"
```

**Expected**:

- account-takeover anchors are spread across the window;
- there is no victim spending while dormant;
- the hour-of-day histogram is not flat;
- a merged export keeps `actor_id` and `campaign_step`, and its RSS stays flat whatever the
  run's size.

## Downstream: analytics-flink

After the US2 engine-version bump (wire format change), rebuild the Flink jobs and confirm that `CleanAndOrderJob` orders by
`delivered_at` (contracts/wire-format.md).
