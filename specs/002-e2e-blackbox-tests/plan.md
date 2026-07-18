# Implementation Plan: End-to-End Blackbox Test Suite

**Branch**: `002-e2e-blackbox-tests` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-e2e-blackbox-tests/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Add a merge-blocking e2e blackbox suite that provisions the real shipped `docker compose up`
stack (api+SPA, worker, MySQL, Redis, plus the existing `demo-brokers` profile for Kafka and
RabbitMQ), then drives the product exactly as users do: the six-surface Web UI through a real
Chromium browser, and the `/mcp` streamable-HTTP endpoint as an agent would. Four prioritized
stories map to four spec files: golden path via UI (P1), delivery verification across all four
sinks (P2), MCP↔UI parity (P3), and end-to-end determinism via double-run byte comparison (P4).
Technical approach: a new dev-only `apps/e2e` workspace package using Playwright Test (chosen
because its built-in `retries: 1` + "flaky" classification, trace/screenshot capture, and HTML
report implement FR-013/FR-014 natively), a compose overlay file for test-only networking
(webhook listener reachability, api healthcheck), a tiny committed seed+spec fixture, and a new
required CI job with docker-layer caching to hold the <5-minute budget.

## Technical Context

**Language/Version**: TypeScript 5.x (strict) on Node.js 22 LTS — same toolchain as the monorepo

**Primary Dependencies**: `@playwright/test` (browser automation + test runner + retry/flake
reporting), `@modelcontextprotocol/sdk` (MCP client over streamable HTTP — already a workspace
dependency server-side), `@confluentinc/kafka-javascript` and `amqplib` (host-side sink
consumers, already in the workspace), Node `http` (in-suite webhook listener), Docker Compose v2
(environment lifecycle via `up --wait` / `down -v`)

**Storage**: none of its own — the suite observes the stack's `./data` bind mount (truth
records, file-sink output, exports) and external broker topics/queues; all state is torn down
per execution (FR-011)

**Testing**: Playwright Test for the suite itself (`pnpm test:e2e`); existing Vitest projects
(unit/contract/component/integration) are untouched and remain separate

**Target Platform**: Linux CI runners (GitHub Actions, Docker preinstalled) and macOS/Linux
developer machines — identical invocation both places (FR-012)

**Project Type**: dev-only test application in the pnpm workspace (`apps/e2e`) — ships nothing
to the product image; `docker compose up` for end users is unchanged

**Performance Goals**: full suite (provisioning + all stories + teardown) under 5 minutes on CI
(FR-010, SC-002); tiny fixture runs complete in seconds each so the double-run determinism story
fits the budget

**Constraints**: blackbox discipline — UI scenarios go through rendered pages only (FR-002), MCP
scenarios through the public `/mcp` endpoint only; no test hooks inside product code paths; the
only product-code change permitted is adding stable `data-testid` attributes (currently absent
from `apps/web`) which do not alter behavior; compose overlay may add test-only networking
(extra_hosts, healthcheck) but never new product services

**Scale/Scope**: 4 spec files (one per story), ~15 acceptance scenarios total, 1 committed
fixture (tens of consumers/merchants, days of virtual time), 4 sink verification targets, 1 new
CI job, 1 compose overlay file

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Constitution v1.1.0 — five gates instantiated for this feature:

| #   | Gate                              | How this plan satisfies it                                                                                                                                                                                                                                                 | Status |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Static (strict TS, zero warnings) | `apps/e2e` joins the workspace tsconfig/eslint/prettier roots; Playwright specs and helpers are strict TS; no `any` (MCP tool results parsed through typed helpers)                                                                                                        | PASS   |
| 2   | Test gate (test-first)            | The feature _is_ tests; red→green applies literally — specs are written against the running stack and fail until selectors/fixtures are wired. No engine/validator/API logic is added, so no new unit/property/golden-master obligations arise; existing suites unaffected | PASS   |
| 3   | Determinism gate                  | No engine changes, golden masters untouched. The suite _strengthens_ this gate: US4 verifies byte-identical truth output through the full deployed stack, a layer no existing test covers                                                                                  | PASS   |
| 4   | Performance gate                  | No generation/delivery-path changes, so no benchmark obligation triggers. The suite declares its own measured budget (<5 min, SC-002) and the CI job fails if exceeded (job-level timeout)                                                                                 | PASS   |
| 5   | Review gate                       | PR review checklist references this table; the one product-code touch (adding `data-testid` attributes to `apps/web`) is behavior-neutral and reviewed under the same gate                                                                                                 | PASS   |

Principle-level checks: distribution constraint honored — no new service in `docker-compose.yml`;
the e2e overlay (`apps/e2e/compose.e2e.yml`) is applied only by the suite via `-f`, and end-user
`docker compose up` is byte-for-byte unchanged. Principle IV consistency is directly enforced by
US3 (MCP↔UI parity assertions). No LLM anywhere. Apache-2.0-compatible dev dependencies only.

**Post-design re-evaluation (after Phase 1)**: PASS — design artifacts introduce no product
state, no new services, no engine surface; the suite's only interfaces are the public UI, the
public `/mcp` endpoint, compose lifecycle commands, and read-only observation of `./data` and
broker topics.

## Project Structure

### Documentation (this feature)

```text
specs/002-e2e-blackbox-tests/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── suite-interface.md  # invocation, env vars, exit semantics, CI contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/e2e/                        # NEW dev-only workspace package (never shipped)
├── package.json                 # @txloom/e2e — @playwright/test + client deps
├── playwright.config.ts         # retries: 1, workers: 1, trace/screenshot on failure,
│                                # global setup/teardown, 5-min-aware timeouts
├── compose.e2e.yml              # test-only overlay: api healthcheck (/health),
│                                # extra_hosts host-gateway for webhook listener,
│                                # tmpfs for mysql (speed) — applied only via -f by the suite
├── fixtures/
│   └── tiny-scenario.json       # committed seed+spec: tens of consumers/merchants,
│                                # days of virtual time, all 3 typologies at high rates
├── src/
│   ├── global-setup.ts          # compose up --wait (project name txloom-e2e), fail with
│   │                            # per-container diagnosis if unhealthy
│   ├── global-teardown.ts       # compose down -v + data/ scrub (FR-011)
│   ├── compose.ts               # compose command wrapper, log capture on failure
│   ├── webhook-listener.ts      # in-suite HTTP receiver (host port, reached via
│   │                            # host.docker.internal from worker container)
│   ├── kafka-consumer.ts        # host-side topic reader (localhost:9092)
│   ├── rabbitmq-consumer.ts     # host-side queue reader (localhost:5672)
│   ├── mcp-client.ts            # typed MCP client over streamable HTTP to /mcp
│   └── ui.ts                    # shared locator helpers per surface (data-testid based)
└── tests/
    ├── 01-golden-path.spec.ts   # US1: author→validate→run→inspect→report→export via UI
    ├── 02-sinks.spec.ts         # US2: file/Kafka/RabbitMQ/webhook delivery + label exclusion
    ├── 03-mcp-parity.spec.ts    # US3: same lifecycle via MCP tools, outcomes vs UI run
    └── 04-determinism.spec.ts   # US4: double run, byte-diff truth records + payloads

apps/web/src/                    # TOUCHED: add stable data-testid attributes to the six
                                 # surfaces' key interaction points (behavior-neutral)

.github/workflows/ci.yml         # TOUCHED: new required `e2e` job (docker layer cache,
                                 # compose build, pnpm test:e2e, artifact upload on failure)

package.json                     # TOUCHED: root script `test:e2e`
```

**Structure Decision**: a dedicated `apps/e2e` workspace package keeps the suite inside the
monorepo's static gates (strict TS, lint, format) while staying out of every product build; the
four numbered spec files mirror the four prioritized user stories so each story is independently
runnable (`--grep`), matching the spec's independent-test requirement.

## Complexity Tracking

> No constitution violations — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| —         | —          | —                                    |
