# Quickstart: E2E Blackbox Suite

**Feature**: `002-e2e-blackbox-tests`

## Run locally

```bash
# one-time
pnpm install
pnpm exec playwright install chromium

# full suite (provisions the real compose stack, runs all stories, tears down)
pnpm test:e2e

# a single story on a fresh stack
pnpm test:e2e --grep @us1     # golden path (UI)
pnpm test:e2e --grep @us2     # four sinks
pnpm test:e2e --grep @us3     # MCP ↔ UI parity
pnpm test:e2e --grep @us4     # determinism double-run

# keep the stack up after a failure to poke around
E2E_KEEP_STACK=1 pnpm test:e2e --grep @us1
docker compose -p txloom-e2e down -v    # manual cleanup afterwards
```

**Prerequisites**: Docker with Compose v2 running; ports 3000, 9092, 5672 free. Nothing else —
no config files, no env vars (FR-012).

## Read results

- Terminal summary lists each scenario as passed / **flaky** (passed on retry — FR-014) / failed.
- `apps/e2e/playwright-report/` — HTML report; failures include trace, screenshot, and the
  surface/step that failed (FR-013).
- On provisioning failure, the error names the container that never became healthy and dumps its
  logs.

## CI

The `e2e` job in `.github/workflows/ci.yml` runs the identical `pnpm test:e2e` on every PR.
On failure, download the `e2e-artifacts` upload (Playwright report + compose logs) from the run.

**One-time repo-admin step (SC-006)**: add `e2e` to the required status checks in branch
protection for `main` — this cannot be enforced from the repo contents.

## Rules of the suite

- Blackbox only: UI stories interact with rendered pages; MCP stories use the public `/mcp`
  endpoint. No direct DB access, no REST shortcuts inside UI stories, no product test hooks.
- The fixture (`apps/e2e/fixtures/tiny-scenario.json`) is a committed artifact — editing it
  re-baselines every story; don't touch it casually.
- The compose overlay (`apps/e2e/compose.e2e.yml`) may carry test-only networking/healthcheck
  plumbing, never new services; the shipped `docker-compose.yml` stays byte-identical for users.
