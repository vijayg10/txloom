---
description: "Task list for the end-to-end blackbox test suite"
---

# Tasks: End-to-End Blackbox Test Suite

**Input**: Design documents from `/specs/002-e2e-blackbox-tests/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R10), data-model.md, contracts/suite-interface.md, quickstart.md

**Nature of this feature**: The deliverables ARE tests — Playwright spec files that drive the
real `docker compose` stack as a blackbox. There is no product engine/validator/API logic added
here, so the usual "write failing unit test → implement" ordering does not apply. Instead, the
harness (Phase 2) is a blocking prerequisite, and each user story is one spec file that is written
red (fails until selectors/fixtures/observers are correctly wired) then driven green against the
running stack. The only product-code change permitted is behavior-neutral `data-testid`
attributes in `apps/web` (research.md R7).

**Organization**: Tasks are grouped by user story so each story can be implemented and run
independently via `pnpm test:e2e --grep @usN` against a fresh stack.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4; Setup/Foundational/Polish tasks carry no story label

## Path Conventions

New dev-only workspace package at `apps/e2e/` (auto-included via the existing `apps/*` glob in
`pnpm-workspace.yaml`). Product touch points: `apps/web/src/surfaces/*` (test-ids only),
`.github/workflows/ci.yml`, root `package.json`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the `apps/e2e` package so it joins the workspace's static gates and can run.

- [ ] T001 Create `apps/e2e/package.json` for `@txloom/e2e` (private, `type: module`) with devDependencies `@playwright/test` and `@modelcontextprotocol/sdk`, workspace deps `@confluentinc/kafka-javascript` and `amqplib`, and a `test:e2e` script running `playwright test`
- [ ] T002 Add `apps/e2e/tsconfig.json` extending `tsconfig.base.json` (strict) and covering `src/` + `tests/`; confirm `apps/e2e` is picked up by the root `apps/*` workspace glob and by the root eslint/prettier config (no `any`, per plan Constitution gate 1)
- [ ] T003 Add root `package.json` script `"test:e2e": "pnpm --filter @txloom/e2e test:e2e"` and run `pnpm install` to link the new package
- [ ] T004 Create `apps/e2e/playwright.config.ts`: single `chromium` project, `workers: 1`, `retries: 1`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`, HTML reporter to `apps/e2e/playwright-report/`, `use.baseURL` from `E2E_BASE_URL` (default `http://localhost:3000`), and `globalSetup`/`globalTeardown` pointing at Phase 2 files (research.md R1)
- [ ] T005 Document local bootstrap (`pnpm exec playwright install chromium`) — verify against quickstart.md so the two stay consistent

**Checkpoint**: `pnpm test:e2e` resolves and runs Playwright (0 tests) without error.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared harness every story depends on — environment lifecycle, sink observers,
MCP client, UI selector infrastructure, and the fixture.

**⚠️ CRITICAL**: No user story spec can be written to green until this phase is complete.

### Environment lifecycle (research.md R2, R3)

- [ ] T006 Create `apps/e2e/compose.e2e.yml` overlay: add an `api` healthcheck against `/health`, `extra_hosts: ["host.docker.internal:host-gateway"]` on `api` and `worker`, and tmpfs for MySQL data — no new services (plan Constitution note; R3)
- [ ] T007 [P] Create `apps/e2e/src/compose.ts`: wrapper running `docker compose -p txloom-e2e -f docker-compose.yml -f apps/e2e/compose.e2e.yml --profile demo-brokers <cmd>`, with helpers to capture `compose ps` + per-service logs on demand
- [ ] T008 Create `apps/e2e/src/global-setup.ts`: `up -d --build --wait`; on failure, identify the unhealthy container and dump its logs, then throw with a clear message (spec edge case: startup failure). Depends on T007
- [ ] T009 Create `apps/e2e/src/global-teardown.ts`: `down -v` plus scrub of the host `./data` bind mount so no state survives (FR-011); honor `E2E_KEEP_STACK=1` to skip teardown. Depends on T007

### Fixture (research.md R10)

- [ ] T010 [P] Create `apps/e2e/fixtures/tiny-scenario.json`: fixed seed, ~30 consumers / ~10 merchants / a few days of virtual time, all 3 fraud typologies + all 4 imperfection types at elevated rates, single currency (FR-008); verify it passes the product's own validation before committing

### Sink observers (research.md R4, R5)

- [ ] T011 [P] Create `apps/e2e/src/webhook-listener.ts`: in-suite Node `http` server on an ephemeral host port recording received method/headers/body/receive-time for assertion; expose start/stop and a "received" accessor
- [ ] T012 [P] Create `apps/e2e/src/kafka-consumer.ts`: host-side consumer over `@confluentinc/kafka-javascript` reading `localhost:9092`, collecting messages from a target topic
- [ ] T013 [P] Create `apps/e2e/src/rabbitmq-consumer.ts`: host-side consumer over `amqplib` reading `localhost:5672`, collecting messages from a target queue

### MCP client (research.md R6)

- [ ] T014 [P] Create `apps/e2e/src/mcp-client.ts`: typed `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport` to `http://localhost:3000/mcp`, with typed helpers for the validate/scenario/run/export/read tools and no `any` on parsed results

### UI selector infrastructure (research.md R7)

- [ ] T015 [P] Add behavior-neutral `data-testid` attributes to `apps/web/src/surfaces/scenario-workspace/*` (spec editor, validate control, validation-result panel, save/run entry points)
- [ ] T016 [P] Add behavior-neutral `data-testid` attributes to `apps/web/src/surfaces/run-control/*` (launch control, run status/progress indicator, per-run export trigger)
- [ ] T017 [P] Add behavior-neutral `data-testid` attributes to `apps/web/src/surfaces/stream-console/*` and `apps/web/src/surfaces/world-inspector/*` (post-run data panels)
- [ ] T018 [P] Add behavior-neutral `data-testid` attributes to `apps/web/src/surfaces/ground-truth/*` and the realism-report panel (truth/label views, report metrics)
- [ ] T019 [P] Add behavior-neutral `data-testid` attributes to `apps/web/src/surfaces/settings/*` (Connections & settings: sink connection create/edit, label-inclusion toggle/warning)
- [ ] T020 Create `apps/e2e/src/ui.ts`: role/text-first locator helpers keyed to the test-ids from T015–T019, one helper group per surface (author spec, validate, launch run, wait-for-complete, open inspector/ground-truth, open report, configure sink, trigger export). Depends on T015–T019

**Checkpoint**: Harness compiles under strict TS; `global-setup` brings the full stack healthy and `global-teardown` removes it cleanly.

---

## Phase 3: User Story 1 - Golden path via Web UI (Priority: P1) 🎯 MVP

**Goal**: Prove a real user can complete author → validate → run → inspect → report → export
entirely through the rendered SPA against the full stack (FR-002, FR-003).

**Independent Test**: `pnpm test:e2e --grep @us1` against a fresh stack passes, exercising all six
surfaces with no API shortcuts.

- [ ] T021 [US1] Create `apps/e2e/tests/01-golden-path.spec.ts` tagged `@us1`; using `ui.ts`, author the tiny fixture spec in the Scenario Workspace and assert validation reports no errors (spec acceptance scenarios 1) — write red first, then wire selectors green
- [ ] T022 [US1] In the same spec, launch a batch run from Run Control and assert live progress becomes visible and the run reaches completed state (acceptance scenario 2; batch-only per clarification). Depends on T021
- [ ] T023 [US1] Extend the spec to open Stream Console, World Inspector, and Ground Truth after completion and assert each renders data consistent with the run (acceptance scenario 3). Depends on T022
- [ ] T024 [US1] Extend the spec to open the realism report and assert it renders and reflects the run's actual scale/duration (acceptance scenario 5). Depends on T022
- [ ] T025 [US1] Extend the spec to trigger an export from the UI and assert the produced file under `./data` is retrievable and non-empty (acceptance scenario 4). Depends on T022

**Checkpoint**: US1 is fully functional and independently runnable — the MVP.

---

## Phase 4: User Story 2 - Delivery across all four sinks (Priority: P2)

**Goal**: Verify events reach file, Kafka, RabbitMQ, and webhook targets as an external consumer
sees them, and that labels are excluded from default exports (FR-004, FR-005).

**Independent Test**: `pnpm test:e2e --grep @us2` against a fresh stack passes, with all four
observers confirming delivery.

- [ ] T026 [US2] Create `apps/e2e/tests/02-sinks.spec.ts` tagged `@us2`; configure a run (via UI Connections surface, blackbox-style) with a file sink and assert expected output files exist under `./data` with expected event counts (acceptance scenario 1)
- [ ] T027 [P] [US2] Add Kafka delivery assertion using `kafka-consumer.ts`: sink configured to `kafka:29092`, consumer observes expected events on `localhost:9092` (acceptance scenario 2). Same spec file, distinct test block
- [ ] T028 [P] [US2] Add RabbitMQ delivery assertion using `rabbitmq-consumer.ts`: sink configured to `rabbitmq:5672`, consumer observes expected events on `localhost:5672` (acceptance scenario 3)
- [ ] T029 [P] [US2] Add webhook delivery assertion using `webhook-listener.ts`: sink configured to `http://host.docker.internal:<port>/hook`, listener records expected calls (acceptance scenario 4)
- [ ] T030 [US2] Add label-exclusion assertion: inspect a sink's default export and assert fraud/imperfection labels are absent unless the run explicitly opts in (acceptance scenario 5, FR-005). Depends on T026

**Checkpoint**: US1 and US2 both pass independently.

---

## Phase 5: User Story 3 - MCP ↔ UI parity (Priority: P3)

**Goal**: An agent driving TxLoom purely through `/mcp` reaches the same outcomes as the UI flow
(FR-006, Constitution Principle IV).

**Independent Test**: `pnpm test:e2e --grep @us3` against a fresh stack passes, comparing
MCP-driven outcomes to their UI equivalents.

- [ ] T031 [US3] Create `apps/e2e/tests/03-mcp-parity.spec.ts` tagged `@us3`; submit the tiny fixture spec via the MCP validate tool and assert validation results match what the UI shows for the same spec (acceptance scenario 1)
- [ ] T032 [US3] Launch and complete a run via MCP scenario/run tools and assert it reaches the same completed state and equivalent output to the US1 UI-driven run (acceptance scenario 2). Depends on T031
- [ ] T033 [US3] Retrieve ground truth and realism report via MCP read tools and assert they match the UI-rendered equivalents (acceptance scenario 3). Depends on T032

**Checkpoint**: US1–US3 each pass independently.

---

## Phase 6: User Story 4 - Determinism under full-stack execution (Priority: P4)

**Goal**: Same seed + spec run twice through the deployed stack yields byte-identical truth
records and delivered payloads (FR-007, Constitution Principle II).

**Independent Test**: `pnpm test:e2e --grep @us4` against a fresh stack passes, byte-diffing two
runs.

- [ ] T034 [US4] Create `apps/e2e/tests/04-determinism.spec.ts` tagged `@us4`; run the tiny fixture (fixed seed) twice end-to-end and assert the resulting truth records under `./data` are byte-identical between runs (acceptance scenario 1; research.md R8)
- [ ] T035 [US4] Attach a file sink and the webhook listener to both runs and assert delivered payload bodies are byte-identical after stripping transport envelope fields (receive timestamps/headers) (acceptance scenario 2, R8). Depends on T034

**Checkpoint**: All four stories pass independently and together.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: CI enforcement, budget guard, and diagnostics that span all stories.

- [ ] T036 Add an `e2e` job to `.github/workflows/ci.yml` (runs on every PR and push to main): pnpm install → `playwright install chromium --with-deps` (cached) → compose build with buildx `type=gha` cache → `pnpm test:e2e` → upload Playwright report + compose logs as `e2e-artifacts` on failure (FR-009, FR-013, research.md R9)
- [ ] T037 Set the CI `e2e` job `timeout-minutes: 10` hard stop and add a suite-internal assertion that the test phase stayed within the <5-minute warm-cache budget (FR-010, SC-002, contracts/suite-interface.md)
- [ ] T038 [P] Verify flake reporting end-to-end: confirm a pass-on-retry scenario surfaces as `flaky` (not silently `passed`) in both the Playwright report and CI summary (FR-014)
- [ ] T039 [P] Document in quickstart.md the one-time repo-admin step to mark `e2e` a required status check in `main` branch protection (SC-006), and confirm the `E2E_KEEP_STACK` / `E2E_BASE_URL` env vars behave as the contract states
- [ ] T040 Run the full `pnpm test:e2e` locally per quickstart.md and confirm green end-to-end within budget, then confirm `CLAUDE.md` still points at this feature's plan

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–6)**: all depend on Foundational. US1 is the MVP. US2 and US4 reuse
  the UI helpers (T020) and sink observers; US3 depends only on the MCP client (T014). US3
  compares against the US1 outcome conceptually but is independently runnable against a fresh
  stack (it re-derives its own UI baseline where needed).
- **Polish (Phase 7)**: depends on the stories you intend to ship being green.

### Within Each User Story

- Each story is one spec file built up across its tasks (sequential on the same file), except
  US2's per-sink assertions (T027–T029) which touch independent observers and can be developed
  in parallel before merging into the spec.

### Parallel Opportunities

- Setup: T002 after T001; T004/T005 alongside once the package exists.
- Foundational: T007, T010, T011, T012, T013, T014 are independent [P]; the six test-id sweeps
  T015–T019 are independent [P] across different surface directories; T020 waits on them; T008/T009
  wait on T007.
- Stories: US1, US2, US3, US4 can be built by different people once Phase 2 is done.

---

## Parallel Example: Foundational Phase

```bash
# Independent harness modules (different files, no shared deps):
Task: "Create apps/e2e/src/compose.ts"            # T007
Task: "Create apps/e2e/fixtures/tiny-scenario.json"  # T010
Task: "Create apps/e2e/src/webhook-listener.ts"   # T011
Task: "Create apps/e2e/src/kafka-consumer.ts"     # T012
Task: "Create apps/e2e/src/rabbitmq-consumer.ts"  # T013
Task: "Create apps/e2e/src/mcp-client.ts"         # T014

# Six independent test-id sweeps (different surface directories):
Task: "data-testid: scenario-workspace"  # T015
Task: "data-testid: run-control"         # T016
Task: "data-testid: stream-console + world-inspector"  # T017
Task: "data-testid: ground-truth + report"  # T018
Task: "data-testid: settings"            # T019
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → 2. Phase 2 Foundational (harness) → 3. Phase 3 US1 golden path →
4. **STOP and VALIDATE**: `pnpm test:e2e --grep @us1` green against a fresh stack.

### Incremental Delivery

Foundational ready → US1 (MVP, merge-worthy on its own) → US2 sinks → US3 MCP parity →
US4 determinism → Phase 7 CI enforcement. Each story adds a runnable, independently green
increment without disturbing the previous ones.

---

## Notes

- [P] = different files, no dependencies. [Story] labels map tasks to spec.md user stories.
- Blackbox discipline: UI stories go through rendered pages only; MCP story uses `/mcp` only; the
  sole product-code change is behavior-neutral `data-testid`s (T015–T019).
- The shipped `docker-compose.yml` stays byte-identical for end users — all test networking lives
  in the `-f` overlay (T006).
- Commit after each task or logical group; keep the fixture (T010) stable — editing it re-baselines
  every story.
