# Data Model: End-to-End Blackbox Test Suite

**Feature**: `002-e2e-blackbox-tests` | **Date**: 2026-07-18

This feature adds no product data — no tables, no migrations, no API resources. Its entities
are test artifacts. Decisions referenced as R# come from [research.md](./research.md).

## Entities

### Synthetic Test Fixture (R10)

The single committed seed+spec pair every story runs.

| Field | Type | Notes |
|-------|------|-------|
| `seed` | integer | Fixed forever; changing it is a fixture version change |
| `spec` | TxLoom scenario spec (JSON) | Must pass the product's own validation battery untouched |
| — scale | ~30 consumers / ~10 merchants / days of virtual time | FR-008: far below reference scale |
| — coverage | all 3 typologies + all 4 imperfection types at elevated rates | keeps label/fraud assertions meaningful at tiny volume |
| — currency | single | product constraint |

**Validation rules**: the fixture file is loaded verbatim (never templated at runtime); any edit
requires re-baselining expectations in all four spec files.

**Relationships**: consumed by every Suite Scenario; is the shared basis making US3 (UI vs MCP)
and US4 (run vs run) comparisons valid.

### Sink Verification Target (R3–R5)

The per-sink external observation point.

| Sink | Product-side address (configured via UI/MCP) | Suite-side observer |
|------|----------------------------------------------|---------------------|
| file | `DATA_DIR` inside containers | host `./data` bind mount, direct file reads |
| Kafka | `kafka:29092` (in-network listener) | consumer on `localhost:9092` (host listener) |
| RabbitMQ | `rabbitmq:5672` | consumer on `localhost:5672` |
| webhook | `http://host.docker.internal:<port>/hook` | in-suite Node HTTP listener (records method, headers, body, receive time) |

**Validation rules**: observers assert event **count** and **payload content**; for US4 they
additionally assert byte-identity of payload bodies across runs (transport envelope excluded, R8).

**State**: observers are created before their story and closed after it; no observer state
survives a suite execution (FR-011).

### Suite Execution Report (R1, R9)

The pass/fail outcome surfaced as the CI check.

| Field | Source | Notes |
|-------|--------|-------|
| per-scenario status | Playwright report | `passed` / `failed` / **`flaky`** (pass-on-retry, FR-014) |
| failure diagnostics | trace, screenshot, video, step name | FR-013: names surface + step; captured only on failure |
| environment diagnostics | compose logs + `compose ps` snapshot | captured by global setup/teardown on provisioning failure or test failure |
| duration | Playwright report + CI job time | budget guard: job `timeout-minutes` (FR-010) |

**State transitions**: scenario → `failed` only after one automatic retry also fails; `flaky`
is a passing terminal state that must remain visible in the report (never collapsed into plain
`passed`).

## Test-Run Lifecycle (per suite execution)

```
provision (compose up --wait, project txloom-e2e)
  → US1 golden path (UI)            — creates scenario A, run A1
  → US2 sinks (UI/API-configured)   — creates run A2 with all four sinks attached
  → US3 MCP parity                  — establishes its own UI baseline in beforeAll, then creates
                                       scenario B via MCP, run B1; compares MCP vs that baseline
  → US4 determinism                 — creates runs C1, C2 (same seed+spec); byte-diffs outputs
teardown (compose down -v, scrub ./data)
```

Stories are sequential (`workers: 1`) and share one stack. US3 does not read US1's run; it
establishes its own UI baseline in `beforeAll` and compares its MCP-driven outcomes against that.
Each story therefore remains independently runnable via `--grep` against a fresh stack,
satisfying the spec's independent-test requirement.
