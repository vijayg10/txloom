# Research: End-to-End Blackbox Test Suite

**Feature**: `002-e2e-blackbox-tests` | **Date**: 2026-07-18

All Technical Context unknowns resolved. Decisions below are numbered R1–R10 for reference from
data-model.md, contracts/, and tasks.md.

## R1. Test runner & browser automation: Playwright Test

- **Decision**: `@playwright/test` as both the browser driver and the suite's test runner, with
  a single Chromium project (per clarification), `workers: 1`, `retries: 1`.
- **Rationale**: Playwright's built-in retry model classifies a pass-on-retry as **flaky** in
  its report — that is FR-014 verbatim, for free. Trace, screenshot, and video capture on
  failure satisfy FR-013's "diagnose without reproducing" requirement natively. Its runner also
  hosts the non-browser stories (MCP, sink consumers) so the whole suite is one invocation, one
  report, one CI job.
- **Alternatives considered**: Vitest + playwright library (rejected: retries/flake reporting
  and trace capture would be hand-built; mixing e2e into the existing Vitest workspace risks
  entangling fast suites with Docker lifecycles); Cypress (rejected: weaker non-browser story
  support — MCP/sink tests would need a second runner); Selenium (rejected: no integrated
  runner/reporting).

## R2. Environment lifecycle: compose `up --wait` / `down -v` around the whole suite

- **Decision**: Playwright global setup runs
  `docker compose -p txloom-e2e -f docker-compose.yml -f apps/e2e/compose.e2e.yml --profile demo-brokers up -d --build --wait`;
  global teardown runs `down -v` plus a scrub of the `./data` bind mount. One stack per suite
  execution; the fixed project name `txloom-e2e` keeps it isolated from any developer's normal
  `docker compose up` stack.
- **Rationale**: This is the _shipped_ compose file — the highest-fidelity blackbox environment
  (FR-001) — and `--wait` leverages healthchecks so a component that fails to start is named
  precisely (edge case: startup failure). `down -v` + data scrub gives FR-011's clean slate.
- **Alternatives considered**: Testcontainers-orchestrated equivalent (rejected by user in
  interview — lower fidelity to the shipped artifact); leaving the stack up between runs
  (rejected: violates FR-011 isolation).

## R3. Test-only compose overlay (`apps/e2e/compose.e2e.yml`)

- **Decision**: A small overlay applied only by the suite via `-f`, containing exactly:
  (a) an `api` healthcheck hitting `/health` so `--wait` covers the app tier (the shipped file
  only healthchecks mysql/redis); (b) `extra_hosts: host.docker.internal:host-gateway` on
  `worker` and `api` so the in-suite webhook listener on the host is reachable from containers
  on Linux CI (Docker Desktop provides this alias automatically; Linux does not); (c) tmpfs for
  MySQL data to cut startup/IO time toward the 5-minute budget.
- **Rationale**: Networking and readiness plumbing for tests must not leak into the end-user
  compose file (constitution distribution constraint); an overlay keeps `docker compose up`
  byte-identical for users while remaining declarative and reviewable.
- **Alternatives considered**: modifying `docker-compose.yml` directly (rejected: pollutes the
  shipped artifact); running the webhook listener as a compose service (rejected: adds a test
  container to the product file or requires the overlay anyway, and an in-suite listener gives
  the test direct, synchronous access to received payloads).

## R4. Webhook verification target: in-suite Node HTTP listener

- **Decision**: The suite starts a plain Node `http` server on an ephemeral host port before the
  webhook story; the sink connection is configured (through the product UI/MCP, blackbox-style)
  with URL `http://host.docker.internal:<port>/hook`. Received requests are recorded in memory
  for assertion.
- **Rationale**: Matches the spec's assumption ("a lightweight listener the suite itself stands
  up"); gives byte-level access to delivered payloads for both US2 and US4 comparisons.
- **Alternatives considered**: mock-server containers (rejected: extra moving part, indirect
  assertion API).

## R5. Kafka/RabbitMQ verification: host-side consumers against demo brokers

- **Decision**: Reuse the workspace's existing client libraries as host-side consumers:
  `@confluentinc/kafka-javascript` reading `localhost:9092`, `amqplib` reading
  `localhost:5672`. Sink connections inside the product are configured with the in-network
  addresses (`kafka:29092`, `rabbitmq:5672`) exactly as the shipped compose file documents.
- **Rationale**: The dual-listener topology already exists in `docker-compose.yml` for this
  precise purpose (worker publishes in-network, host tools consume via localhost) — the suite
  observes delivery from _outside_ the stack, which is the blackbox posture FR-004 wants.
- **Alternatives considered**: `kcat` CLI subprocess (rejected: extra binary dependency breaks
  FR-012's "runs identically everywhere"); exec-ing consumers inside containers (rejected: not
  an external observer).

## R6. MCP client: official SDK over streamable HTTP

- **Decision**: `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport` pointed
  at `http://localhost:3000/mcp`, calling the product's registered tools (scenario, validate,
  run, export, read tools) exactly as an external agent would.
- **Rationale**: The server is stateless streamable-HTTP (`apps/api/src/mcp/server.ts`); the
  official client is the reference consumer, so parity failures indict the product, not the
  test harness.
- **Alternatives considered**: raw JSON-RPC over fetch (rejected: re-implements the transport
  and weakens the "as an agent would" claim).

## R7. UI selector strategy: role/text-first, `data-testid` where structure is unnamed

- **Decision**: Prefer Playwright role/label/text locators (they assert accessible structure as
  a side benefit). Where surfaces expose no stable accessible handle, add `data-testid`
  attributes to `apps/web` — the repo currently has **zero** `data-testid`s, so US1's flows
  will require a behavior-neutral sweep over the six surfaces' key controls (spec editor,
  validate/run/export buttons, run status, report panels).
- **Rationale**: FR-013 demands failures name the surface and step — stable selectors are the
  precondition; test-ids are the industry-standard escape hatch and change no behavior
  (constitution gate 5 note in plan.md).
- **Alternatives considered**: CSS/structural selectors only (rejected: brittle, and failures
  become "timeout" rather than "surface X, control Y missing" — exactly the edge case the spec
  forbids).

## R8. Determinism comparison method (US4)

- **Decision**: Run the tiny fixture twice through the full stack (fresh scenario each time,
  same seed+spec). Compare: (a) truth records byte-for-byte via the run-outputs/export files
  under the `./data` bind mount; (b) file-sink delivered output byte-for-byte; (c)
  webhook-delivered payload bodies (captured by R4's listener) after stripping run-identifying
  timestamp fields, per spec.md's own acceptance scenario 2 wording ("excluding run-identifying
  metadata such as timestamps of when the test itself executed"). Confirmed during
  implementation: live-streamed events intentionally stamp `event_id`/`ts` from the real clock at
  delivery time (`drawNextLiveEvent` in `packages/engine/src/streaming/live-world.ts` takes
  `nowMs`) — a live TPS-paced stream's timestamp is supposed to reflect real delivery time, not a
  virtual one, so those two fields (plus the webhook envelope's `delivery_id`, which mirrors
  `event_id`) are excluded from the comparison; every other field is compared verbatim. Batch/history
  truth and file-sink output carry no such wall-clock field and are compared with zero exclusions.
- **Rationale**: `./data` is bind-mounted to the host by the shipped compose file, so the suite
  reads outputs exactly where an operator would; comparing both truth and delivered layers
  covers FR-007's two assertions without any product-side test hook.
- **Alternatives considered**: comparing via API-reported checksums (rejected: trusts the
  product to audit itself — not blackbox); running the second run in a second stack (rejected:
  doubles provisioning time; same-stack sequential runs still verify the guarantee as specified).

## R9. CI integration: one new required `e2e` job with docker layer caching

- **Decision**: Add an `e2e` job to `.github/workflows/ci.yml` (ubuntu-latest, Docker
  preinstalled): pnpm install → `playwright install chromium --with-deps` (cached) → compose
  build with buildx GitHub Actions cache (`cache-from/to: type=gha`) → `pnpm test:e2e` →
  upload Playwright report + compose logs as artifacts on failure. Job-level `timeout-minutes`
  enforces the budget; branch protection marks it required (SC-006 — the protection setting
  itself is a repo-admin step recorded in quickstart.md, not enforceable from code).
- **Rationale**: Image builds are the budget's biggest threat; layer caching plus the existing
  multi-stage Dockerfiles keeps warm-cache builds to seconds. Artifacts satisfy FR-013 in CI.
- **Alternatives considered**: nightly-only (rejected by user); reusing images from a separate
  build job via registry (deferred: added complexity; adopt only if cache misses threaten the
  budget in practice).

## R10. Fixture design (Synthetic Test Fixture)

- **Decision**: One committed `fixtures/tiny-scenario.json`: fixed seed, ~30 consumers, ~10
  merchants, a few days of virtual time, all three fraud typologies and all four imperfection
  types enabled at elevated rates so a tiny event volume still exercises every labeled path;
  single currency; file sink always attached, other sinks attached per-story.
- **Rationale**: FR-008 mandates small-and-fast; elevated rates keep assertions meaningful at
  low volume (e.g., label-exclusion checks need labels to exist). One fixture shared across
  stories keeps UI-vs-MCP (US3) and run-vs-run (US4) comparisons apples-to-apples.
- **Alternatives considered**: generating the fixture at runtime from a template (rejected: the
  fixture must be a stable committed artifact so failures are reproducible and diffable).
