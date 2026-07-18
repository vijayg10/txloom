# Contract: E2E Suite Interface

**Feature**: `002-e2e-blackbox-tests` | **Date**: 2026-07-18

The suite consumes only public product interfaces and exposes one invocation contract to
developers and CI. R# references are to [research.md](../research.md).

## Interfaces the suite consumes (all pre-existing, none modified)

| Interface | Used by | Contract source |
|-----------|---------|-----------------|
| Web UI (six surfaces, served by `api` on `:3000`) | US1, US2, US4 | rendered SPA only — no direct REST calls in UI stories (FR-002) |
| `POST /mcp` (streamable HTTP, stateless) | US3 | MCP tools registered in `apps/api/src/mcp/tools/` — consumed via official SDK client (R6) |
| `GET /health` | global setup readiness (via compose healthcheck overlay, R3) | `{"status":"ok"}` |
| `docker-compose.yml` + `--profile demo-brokers` | environment (R2) | shipped file, unmodified |
| `./data` bind mount | file-sink + truth-output observation (R5, R8) | operator-visible filesystem layout |
| Kafka `localhost:9092` / RabbitMQ `localhost:5672` | sink observers (R5) | demo-broker host listeners documented in compose file |

## Invocation contract

```bash
pnpm test:e2e                 # full suite: provision → all stories → teardown
pnpm test:e2e --grep @us1     # one story against a fresh stack (each spec tagged @us1..@us4)
```

| Aspect | Contract |
|--------|----------|
| Prerequisites | Docker + Compose v2 running; ports 3000, 9092, 5672 free; Chromium installed via `pnpm exec playwright install chromium` |
| Exit code | `0` = all scenarios passed (flaky-but-passed included, FR-014); non-zero otherwise |
| Isolation | compose project `txloom-e2e`; never touches a developer's own `txloom` stack; `down -v` + data scrub always runs, pass or fail (FR-011) |
| Config | zero required configuration; optional env vars only: `E2E_KEEP_STACK=1` (skip teardown for debugging), `E2E_BASE_URL` (default `http://localhost:3000`) |
| Report | Playwright HTML report in `apps/e2e/playwright-report/`; traces/screenshots on failure only (FR-013) |
| Flake visibility | pass-on-retry scenarios listed as `flaky` in report output and CI summary (FR-014) |

## CI contract (R9)

| Aspect | Contract |
|--------|----------|
| Job | `e2e` in `.github/workflows/ci.yml`, runs on every PR and push to main |
| Required check | branch protection lists `e2e` as required (repo-admin step, recorded in quickstart.md) — SC-006 |
| Budget | job `timeout-minutes: 5` was considered too brittle for cold caches; contract is `timeout-minutes: 10` hard stop **plus** a suite-internal assertion that test-phase duration stayed within budget, with warm-cache target <5 min end-to-end (FR-010/SC-002) |
| Caching | buildx `type=gha` layer cache for api/worker images; Playwright browser cache keyed on Playwright version |
| Failure artifacts | Playwright report + compose logs uploaded on failure (FR-013) |

**Note on the budget row**: FR-010 states under-5-minutes as the requirement; the 10-minute
hard stop exists only so a cold-cache first run on a new cache key fails with diagnostics
rather than a bare timeout. Sustained warm-cache runs exceeding 5 minutes are a defect against
FR-010 and must be treated as a failing condition, not accepted drift.

## Product-code touch contract

The only permitted product change is adding `data-testid` attributes in `apps/web` (R7):
behavior-neutral, no styling, no logic, reviewed under constitution gate 5. Any test need that
seems to require deeper product hooks is a design smell and must come back to planning.
