---

description: "Task list for TxLoom — Synthetic Transaction Studio (v1)"
---

# Tasks: TxLoom — Synthetic Transaction Studio (v1)

**Input**: Design documents from `/specs/001-synthetic-transaction-studio/` (plan.md, spec.md,
research.md, data-model.md, contracts/api.md, quickstart.md)

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/api.md ✅

**Tests**: Per Constitution Principle III (Test-First Development — NON-NEGOTIABLE for engine,
validator, and API code), test tasks are REQUIRED for every engine, validator, and API construct
below and MUST be written and failing before their implementation tasks. UI-only visual-polish
tasks may skip a dedicated test task; UI tests are still included wherever plan.md calls them out
explicitly (spec-editor, export controls).

**Organization**: Tasks are grouped by user story (spec.md priorities P1–P6) to enable independent
implementation and testing of each story, after a shared Setup and Foundational phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps the task to spec.md's user stories (US1–US6)
- Every task includes an exact file path (relative to repo root)

## Path Conventions (pnpm workspace monorepo, per plan.md § Project Structure)

- `apps/api/src|tests` — Fastify REST + WebSocket + MCP host
- `apps/worker/src|tests` — BullMQ consumers, piscina pool
- `apps/web/src|tests` — React 18 + Vite SPA (six surfaces)
- `apps/cli/src|tests` — thin automation client
- `packages/spec/src|tests` — spec types, JSON Schema, invariants, differ
- `packages/engine/src|tests` — deterministic world model
- `packages/sinks/src|tests` — sink plugin interface + implementations
- `packages/agent-tools/src|tests` — MCP tool definitions + authoring-docs source
- `docs/agent/` — published agent authoring guide (generated)
- `benchmarks/` — Kafka throughput benchmark + CI smoke variant

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo scaffold — no product behavior yet.

- [X] T001 Create pnpm workspace monorepo skeleton: `apps/{api,worker,web,cli}`,
      `packages/{spec,engine,sinks,agent-tools}`, `docs/agent/`, `benchmarks/` directories per
      plan.md § Project Structure
- [X] T002 [P] Root `package.json` + `pnpm-workspace.yaml` with workspace-wide scripts
      (`typecheck`, `lint`, `test`, `test:integration`, `bench:smoke`, `bench:kafka`, `dev`)
- [X] T003 [P] Shared strict root `tsconfig.base.json` (strict mode, no implicit any) referenced by
      every app/package `tsconfig.json`
- [X] T004 [P] Shared ESLint + Prettier config at workspace root; lint rule banning `Math.random`
      and `Date.now`/wall-clock reads inside `packages/engine/**` (constitution Principle II)
- [X] T005 [P] `apps/api/package.json` + `tsconfig.json` with Fastify, `@fastify/websocket`, Ajv,
      Knex, `mysql2`, BullMQ, `@modelcontextprotocol/sdk` dependencies
- [X] T006 [P] `apps/worker/package.json` + `tsconfig.json` with BullMQ, `ioredis`, `piscina`
      dependencies
- [X] T007 [P] `apps/web/package.json` + `tsconfig.json` with React 18, Vite, Recharts,
      `@monaco-editor/react` dependencies
- [X] T008 [P] `apps/cli/package.json` + `tsconfig.json` (thin HTTP client, no framework deps)
- [X] T009 [P] `packages/spec/package.json` + `tsconfig.json` with Ajv as its only runtime
      dependency
- [X] T010 [P] `packages/engine/package.json` + `tsconfig.json` with `pure-rand`, `d3-random`
      dependencies
- [X] T011 [P] `packages/sinks/package.json` + `tsconfig.json` with `@confluentinc/kafka-javascript`,
      `amqplib`, `@dsnp/parquetjs` dependencies
- [X] T012 [P] `packages/agent-tools/package.json` + `tsconfig.json` depending on
      `@modelcontextprotocol/sdk` and `packages/spec`
- [X] T013 `docker-compose.yml` at repo root: `api`, `worker`, `mysql`, `redis` services plus an
      optional `demo-brokers` profile (local Kafka + RabbitMQ) per plan.md § Target Platform
- [X] T014 [P] Root `.env.example` and a documented Docker volume mount for `data/` (run outputs,
      `data/keys/instance.key`) per data-model.md § Run-output volume layout
- [X] T015 Vitest workspace config (`vitest.workspace.ts`) wiring every app/package into
      `pnpm test`, with a separate `vitest.integration.config.ts` for Testcontainers suites

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Spec validation core, persistence schema, API/worker skeletons, and engine primitives
that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational (validator + engine-core scope — write first, Constitution Principle III) ⚠️

- [X] T016 [P] Invariant-battery harness test in `packages/spec/tests/invariants/harness.test.ts`:
      each invariant function returns a located violation for a known-bad fixture and no violation
      for a known-good fixture (both-cases requirement, FR-003/004)
- [X] T017 [P] RNG determinism test in `packages/engine/tests/rng.test.ts`: identical seed produces
      an identical stream; per-partition substream derivation is deterministic and collision-free
      across partition indices (D7)
- [X] T018 [P] Knex migration round-trip test in `apps/api/tests/integration/db-migrate.test.ts`
      (Testcontainers MySQL): every foundational table migrates up and down cleanly
- [X] T019 [P] Contract test for `GET /health` and `GET /capabilities` in
      `apps/api/tests/contract/test_health_capabilities.ts`

### Implementation for Foundational

- [X] T020 [P] `SimulationSpec` TS types in `packages/spec/src/types.ts` (seed, currency, locale,
      clock, population, seasonality, fraud, outcomes, imperfections, output) per data-model.md
- [X] T021 [P] JSON Schema 2020-12 for `SimulationSpec` in `packages/spec/src/schema.json` mirroring
      T020's top-level keys
- [X] T022 Ajv structural validator in `packages/spec/src/ajv-validate.ts` loading `schema.json`,
      returning `{path, code, message}` structural violations (depends on T021)
- [X] T023 [P] Invariant: seasonality windows intersect the clock window in
      `packages/spec/src/invariants/seasonality-window.ts`
- [X] T024 [P] Invariant: archetype weights and typology shares sum to 1±ε in
      `packages/spec/src/invariants/weights-sum.ts`
- [X] T025 [P] Invariant: fraud `target_rate ∈ [0, 0.5]` in
      `packages/spec/src/invariants/fraud-rate-bounds.ts`
- [X] T026 [P] Invariant: account-takeover dormancy precondition satisfiable within `clock.days` in
      `packages/spec/src/invariants/dormancy-satisfiable.ts`
- [X] T027 [P] Invariant: imperfection rates `∈ [0, 0.2]` and imperfection sink targeting refers to
      selected output sinks in `packages/spec/src/invariants/imperfection-bounds.ts`
- [X] T028 [P] Invariant: `clock_skew` sources reference declared sources; `locale` references a
      shipped name-dictionary pack in `packages/spec/src/invariants/reference-integrity.ts`
- [X] T029 [P] Invariant: `then_stream_tps` and population sizes fall within the documented scale
      envelope (warn above reference scale) in `packages/spec/src/invariants/scale-envelope.ts`
- [X] T030 Compose `validateSpec(spec) → {valid, violations[]}` entry point combining Ajv (T022) and
      all invariants (T023–T029) in `packages/spec/src/index.ts` — the one located-violation model
      shared by editor, API, and MCP (FR-004/010)
- [X] T031 [P] JSON-Pointer location helpers in `packages/spec/src/json-pointer.ts`
- [X] T032 [P] Spec differ for version comparison in `packages/spec/src/diff.ts`
- [X] T033 Knex connection + config in `apps/api/src/db/knex.ts` (MySQL 8, `utf8mb4`, JSON columns)
- [X] T034 [P] Migration: `scenarios` table in `apps/api/src/db/migrations/001_scenarios.ts`
- [X] T035 [P] Migration: `spec_versions` table (append-only) in
      `apps/api/src/db/migrations/002_spec_versions.ts`
- [X] T036 [P] Migration: `runs` table in `apps/api/src/db/migrations/003_runs.ts`
- [X] T037 [P] Migration: `run_partitions` table in
      `apps/api/src/db/migrations/004_run_partitions.ts`
- [X] T038 [P] Migration: `streams` table in `apps/api/src/db/migrations/005_streams.ts`
- [X] T039 [P] Migration: `sink_connections` table in
      `apps/api/src/db/migrations/006_sink_connections.ts`
- [X] T040 [P] Migration: `templates` table (read-only, seeded) in
      `apps/api/src/db/migrations/007_templates.ts`
- [X] T041 [P] Migration: `settings` table in `apps/api/src/db/migrations/008_settings.ts`
- [X] T042 Fastify app bootstrap in `apps/api/src/app.ts`: plugin registration order, built-SPA
      static serving (depends on T033)
- [X] T043 [P] Error-envelope plugin in `apps/api/src/plugins/error-envelope.ts`:
      `{error:{code,message,details?}}` for all non-2xx responses
- [X] T044 [P] Ajv request-body validation plugin wiring `packages/spec` schema in
      `apps/api/src/plugins/ajv.ts`
- [X] T045 [P] `GET /health` route in `apps/api/src/routes/health.ts`
- [X] T046 [P] `GET /capabilities` route in `apps/api/src/routes/capabilities.ts` returning
      `{modules: {ai_assist: false, ...}}` (FR-012)
- [X] T047 AES-256-GCM instance-key secrets helper in `apps/api/src/services/secrets.ts`: generates
      `data/keys/instance.key` on first boot, encrypts/decrypts sink credentials (D14)
- [X] T048 BullMQ queue wiring in `apps/api/src/services/queues.ts`: `generate-partition`,
      `stream-drive`, `report-build` queues over Redis
- [X] T049 [P] Piscina worker-pool wiring in `apps/worker/src/pool/piscina-pool.ts`
- [X] T050 Pure-rand seeded RNG core + per-partition substream derivation in
      `packages/engine/src/rng.ts` (D7)
- [X] T051 [P] Virtual clock in `packages/engine/src/clock.ts` (injected clock; no wall-clock reads)
- [X] T052 [P] RNG-checkpoint serialize/restore for idempotent resume in
      `packages/engine/src/rng-checkpoint.ts`
- [X] T053 [P] Sink plugin interface in `packages/sinks/src/interface.ts` — the documented extension
      contract for file/Kafka/RabbitMQ/webhook and future community sinks (FR-027)
- [X] T054 [P] Name-dictionary-pack loader + schema in
      `packages/engine/src/naming/pack-loader.ts` (D18)
- [X] T055 [P] `en-IN` name-dictionary pack data files (given/family name lists, merchant naming
      grammars, sources recorded) in `packages/engine/data/name-packs/en-IN/*.json` (D18)
- [X] T056 CLI skeleton in `apps/cli/src/index.ts`: command registry, typed HTTP client base over
      `contracts/api.md`
- [X] T057 [P] Typed API client for the web SPA in `apps/web/src/api/client.ts`, generated/typed
      from `contracts/api.md`
- [X] T058 React app shell + routing + theme in `apps/web/src/app/shell.tsx`, stub routes for the
      six surfaces (FR-036)
- [X] T059 [P] Capability-gated surface wrapper reading `GET /capabilities` in
      `apps/web/src/app/capability-gate.tsx` (depends on T046)
- [X] T060 Multi-stage Dockerfiles for `api` and `worker` (native `kafka-javascript` build) wired
      into `docker-compose.yml` (D8 consequence)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Generate a deterministic, labeled dataset from a scenario spec (Priority: P1) 🎯 MVP

**Goal**: Author a spec by hand, validate it, run it, and download labeled, reproducible output —
the irreducible core (world model + ground truth + answer key).

**Independent Test**: Author a spec directly in the spec editor, run it, download files and the
label set, and verify labels reconcile with the data, fraud rate approximates the target,
imperfections appear in delivery and are enumerated in the answer key, and a second run with the
same seed/spec is byte-identical.

### Tests for User Story 1 (write first, Constitution Principle III) ⚠️

- [X] T061 [P] [US1] Contract test for `POST/GET /scenarios`, `GET /scenarios/:id`,
      `POST /scenarios/:id/versions` in `apps/api/tests/contract/test_scenarios.ts`
- [X] T062 [P] [US1] Contract test for `POST /spec/validate`, `GET /spec/schema` in
      `apps/api/tests/contract/test_spec_validate.ts`
- [X] T063 [P] [US1] Contract test for `POST /scenarios/:id/runs`, `GET /runs`, `GET /runs/:id` in
      `apps/api/tests/contract/test_runs.ts`
- [X] T064 [P] [US1] Contract test for `GET /runs/:id/truth/events`, `POST /runs/:id/exports`,
      `GET /runs/:id/exports/:exportId/download` in `apps/api/tests/contract/test_exports.ts`
- [X] T065 [P] [US1] Golden-master test: reference-scenario spec + fixed seed against a committed
      reference truth-event sample in
      `packages/engine/tests/golden-master/reference-scenario.test.ts`
- [X] T066 [P] [US1] Property test (fast-check): identical spec+seed under parallel partitioning
      produces byte-identical output, always in
      `packages/engine/tests/property/determinism.test.ts` (SC-001)
- [X] T067 [P] [US1] Property test: achieved fraud rate converges to the configured target across
      typology shares within tolerance in `packages/engine/tests/property/fraud-rate.test.ts`
      (SC-005)
- [X] T068 [P] [US1] Property test: imperfections corrupt only delivered copies, never the truth
      record, and every corruption is enumerated in labels in
      `packages/engine/tests/property/imperfections.test.ts` (FR-024/025)
- [X] T069 [P] [US1] Integration test: full generate → file-export → label-reconciliation loop in
      `apps/worker/tests/integration/generate-run.test.ts` (Testcontainers MySQL)

### Implementation for User Story 1

- [X] T070 [P] [US1] Consumer archetype model + weighted sampling in
      `packages/engine/src/population/consumer-archetypes.ts`
- [X] T071 [P] [US1] Income-pattern generators (fixed credit day + statistical distribution,
      irregular weekly income) in `packages/engine/src/population/income-patterns.ts`
- [X] T072 [P] [US1] Spend-rhythm generators (daily transaction-count distribution, weekend
      multiplier) in `packages/engine/src/population/spend-rhythms.ts`
- [X] T073 [P] [US1] Merchant category model + weighted sampling + per-category amount
      distributions in `packages/engine/src/population/merchants.ts`
- [X] T074 [US1] Party naming assignment at world instantiation from name-dictionary packs in
      `packages/engine/src/naming/assign-names.ts` (depends on T054/T055; FR-014a)
- [X] T075 [US1] Deterministic partitioning of persona space across workers in
      `packages/engine/src/partitioning.ts` (depends on T050; FR-013/018)
- [X] T076 [P] [US1] Seasonality application (date windows × volume multipliers over the virtual
      clock) in `packages/engine/src/seasonality.ts`
- [X] T077 [P] [US1] Card-testing typology (burst size ranges, burst windows, small-amount ranges)
      in `packages/engine/src/fraud/card-testing.ts`
- [X] T078 [P] [US1] Account-takeover typology (dormancy precondition, multi-step script, P2P-drain
      behavior) in `packages/engine/src/fraud/account-takeover.ts`
- [X] T079 [P] [US1] Refund-abuse typology in `packages/engine/src/fraud/refund-abuse.ts`
- [X] T080 [US1] Fraud-actor orchestration: typology share allocation against the target rate,
      multi-step scripts woven into legitimate traffic, achieved-rate reporting in
      `packages/engine/src/fraud/orchestrator.ts` (depends on T077–T079; FR-017/020)
- [X] T081 [P] [US1] Outcome-status model (approved/declined/reversed, baseline decline rate,
      typology-driven decline/refund patterns) in `packages/engine/src/outcomes.ts` (FR-015a)
- [X] T082 [P] [US1] Imperfection: duplicate delivery (per-sink targeting) in
      `packages/engine/src/imperfections/duplicate.ts`
- [X] T083 [P] [US1] Imperfection: late arrival (statistical delay distribution) in
      `packages/engine/src/imperfections/late-arrival.ts`
- [X] T084 [P] [US1] Imperfection: out-of-order delivery in
      `packages/engine/src/imperfections/out-of-order.ts`
- [X] T085 [P] [US1] Imperfection: clock skew (per-source timestamp offset) in
      `packages/engine/src/imperfections/clock-skew.ts`
- [X] T086 [US1] Imperfection pipeline applying configured imperfections to delivered copies only,
      labeling each in the answer key in `packages/engine/src/imperfections/pipeline.ts` (depends
      on T082–T085; FR-024/025)
- [X] T087 [US1] TruthEvent emission (ULID `event_id` derivation, causal traceability) writing
      Parquet partitions to `runs/<run_id>/truth/` in `packages/engine/src/truth-emit.ts` (depends
      on T070–T086)
- [X] T088 [US1] LabelRecord emission to `runs/<run_id>/labels/` in
      `packages/engine/src/label-emit.ts` (depends on T087)
- [X] T089 [P] [US1] Per-partition streaming realism aggregators (counts, moments, t-digest
      quantiles, inter-arrival histograms) in `packages/engine/src/realism/aggregators.ts` (D17)
- [X] T090 [US1] Realism-report merge at run completion + reference-benchmark comparison against
      template `benchmark_refs` in `packages/engine/src/realism/merge-report.ts` → `report.json`
      (depends on T089)
- [X] T091 [P] [US1] File sink: CSV writer in `packages/sinks/src/file/csv.ts`
- [X] T092 [P] [US1] File sink: Parquet writer via `@dsnp/parquetjs` in
      `packages/sinks/src/file/parquet.ts`
- [X] T093 [P] [US1] File sink: JSON writer in `packages/sinks/src/file/json.ts`
- [X] T094 [US1] `generate-partition` BullMQ job: drives the engine per partition, checkpoints
      RNG+clock state, reports progress in `apps/worker/src/jobs/generate-partition.ts` (depends on
      T075, T087, T088; FR-018)
- [X] T095 [US1] `report-build` BullMQ job triggering the realism-report merge on partition
      completion in `apps/worker/src/jobs/report-build.ts` (depends on T090)
- [X] T096 [US1] Idempotent resume from `run_partitions.rng_checkpoint` on worker restart in
      `apps/worker/src/pool/resume.ts` (FR-018, SC-011)
- [X] T097 [US1] Scenario repository (Knex queries) in
      `apps/api/src/db/repositories/scenarios.ts`
- [X] T098 [US1] Spec-version repository, append-only + rollback-as-new-head in
      `apps/api/src/db/repositories/spec-versions.ts` (FR-005)
- [X] T099 [US1] `POST/GET /scenarios`, `GET /scenarios/:id`, `PATCH/DELETE /scenarios/:id` routes
      in `apps/api/src/routes/scenarios.ts` (depends on T097)
- [X] T100 [US1] `GET /scenarios/:id/versions`, `POST /scenarios/:id/versions`,
      `POST .../rollback` routes in `apps/api/src/routes/spec-versions.ts` (depends on T098, T030)
- [X] T101 [US1] `POST /spec/validate`, `GET /spec/schema` routes in
      `apps/api/src/routes/spec.ts` (depends on T030)
- [X] T102 [US1] Run repository + run-partitions repository in
      `apps/api/src/db/repositories/runs.ts`
- [X] T103 [US1] `POST /scenarios/:id/runs` (snapshot spec verbatim, enqueue `generate-partition`
      jobs) in `apps/api/src/routes/runs-launch.ts` (depends on T102, T048, T094)
- [X] T104 [US1] `GET /runs`, `GET /runs/:id`, `GET /runs/:id/logs` routes in
      `apps/api/src/routes/runs-read.ts` (depends on T102)
- [X] T105 [US1] `GET /runs/:id/report` route in `apps/api/src/routes/run-report.ts` (depends on
      T090)
- [X] T106 [US1] `GET /runs/:id/truth/events` route with typology/actor/status/cursor filters in
      `apps/api/src/routes/truth-events.ts` (depends on T088)
- [X] T107 [US1] Export service + `POST /runs/:id/exports`, `GET .../exports/:exportId`,
      `GET .../download` routes in `apps/api/src/routes/exports.ts` and
      `apps/api/src/services/export-service.ts` (label-exclusion by default; FR-021)
- [X] T108 [US1] CLI commands `txloom validate|run|export` in
      `apps/cli/src/commands/{validate,run,export}.ts` (depends on T101, T103, T107)
- [X] T109 [US1] Scenario workspace: Monaco spec editor with schema-aware autocomplete + inline
      invariant errors in `apps/web/src/surfaces/scenario-workspace/spec-editor.tsx` (depends on
      T021, T030)
- [X] T110 [US1] Live structural preview panel (population summary, typology list, imperfection
      profile, estimated volume) in
      `apps/web/src/surfaces/scenario-workspace/structural-preview.tsx`
- [X] T111 [US1] Minimal run-launch UI + run-detail view (status, download links) in
      `apps/web/src/surfaces/run-control/run-launch.tsx` (full run control arrives in US3)

**Checkpoint**: User Story 1 fully functional and independently testable.

---

## Phase 4: User Story 2 - Author a scenario with any AI agent via the agent-integration server (Priority: P2)

**Goal**: Any MCP-capable AI agent can author, validate, save, run, and export a scenario end to
end using only the shipped docs and tools — no embedded LLM in the product.

**Independent Test**: Connect a stock MCP-capable agent to the agent-integration server, request a
scenario in plain English, and verify it converges to a valid spec using only shipped docs, the
scenario appears in the studio for inspection, and agent edits land as new versions.

### Tests for User Story 2 (write first, Constitution Principle III) ⚠️

- [X] T112 [P] [US2] Contract test: each tool in `packages/agent-tools` maps 1:1 onto its REST
      endpoint response shape in `apps/api/tests/contract/test_mcp_parity.ts` (FR-008/012)
- [X] T113 [P] [US2] Integration test: full MCP loop (schema → validate → create → save version →
      launch run → get status → get report → export) in
      `apps/api/tests/integration/mcp-loop.test.ts`

### Implementation for User Story 2

- [X] T114 [US2] Shared agent tool definitions (names, schemas, descriptions) for all v1 tools in
      `packages/agent-tools/src/tools.ts` (FR-012)
- [X] T115 [US2] MCP server mounted at `/mcp` via `@modelcontextprotocol/sdk` streamable-HTTP
      transport in `apps/api/src/mcp/server.ts` (depends on T114; D13)
- [X] T116 [P] [US2] MCP tool handlers: `get_spec_schema`, `get_authoring_docs`, `list_templates` in
      `apps/api/src/mcp/tools/read-tools.ts`
- [X] T117 [P] [US2] MCP tool handler: `validate_spec` in
      `apps/api/src/mcp/tools/validate-spec.ts` (reuses the located violation model verbatim;
      depends on T030)
- [X] T118 [P] [US2] MCP tool handlers: `create_scenario`, `save_spec_version` in
      `apps/api/src/mcp/tools/scenario-tools.ts` (depends on T099, T100)
- [X] T119 [P] [US2] MCP tool handlers: `launch_run`, `get_run_status`, `get_realism_report` in
      `apps/api/src/mcp/tools/run-tools.ts` (depends on T103, T104, T105)
- [X] T120 [P] [US2] MCP tool handlers: `create_export`, `get_export` in
      `apps/api/src/mcp/tools/export-tools.ts` (depends on T107)
- [X] T121 [US2] Per-field annotated spec-schema reference doc source in
      `packages/agent-tools/src/docs/schema-reference.ts`
- [X] T122 [US2] Semantic-invariant catalog doc source (error code + remedy per invariant) in
      `packages/agent-tools/src/docs/invariant-catalog.ts` (depends on T023–T029)
- [X] T123 [US2] Worked example spec per gallery template in
      `packages/agent-tools/src/docs/worked-examples/{upi,card-present,mobile-money,marketplace}.ts`
- [X] T124 [US2] `GET /spec/docs` route assembling doc sources into the agent-facing response in
      `apps/api/src/routes/spec-docs.ts` (depends on T121–T123)
- [X] T125 [US2] `docs/agent/` publish script generating repo-committed markdown from
      `packages/agent-tools` sources in `scripts/build-agent-docs.ts` (depends on T121–T123)
- [X] T126 [US2] Connections & settings: agent-integration connection-details panel (server address,
      authoring-docs links) in `apps/web/src/surfaces/settings/agent-connection.tsx`
- [X] T126a [US2] Agent-convergence eval harness: drive a corpus of plain-English scenario
      descriptions (scoped to the four gallery templates) through a real MCP client against
      `validate_spec`/`save_spec_version`, and report the percentage that converge to a valid spec
      without human hand-editing in `apps/api/tests/eval/agent-convergence.ts` — gates against the
      documented 90% bar (SC-009; depends on T113, T116–T118)

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Control runs and inspect the generated world (Priority: P3)

**Goal**: Launch/pause/cancel/resume runs, watch live progress, and trust the output via the world
inspector and realism report; immutable run records with one-click regeneration and side-by-side
comparison.

**Independent Test**: Launch a run, observe live progress, pause and resume it, then open the
completed run and verify the world inspector renders its charts, the realism report is present,
the run record links spec snapshot + seed + report + outputs immutably, and two runs compare
side by side.

### Tests for User Story 3 (write first, Constitution Principle III) ⚠️

- [ ] T127 [P] [US3] Contract test: run pause/resume/cancel/regenerate, `DELETE .../outputs` in
      `apps/api/tests/contract/test_run_control.ts`
- [ ] T128 [P] [US3] Contract test: `GET /runs/:id/inspector/*` aggregates, `GET /runs/compare` in
      `apps/api/tests/contract/test_inspector.ts`
- [ ] T129 [P] [US3] Integration test: pause/resume mid-run resumes with zero duplicated or missing
      truth events in `apps/worker/tests/integration/pause-resume.test.ts` (FR-018, SC-011)
- [ ] T130 [P] [US3] WS contract test: `runs/:id/progress` channel message shapes in
      `apps/api/tests/contract/test_ws_progress.ts`

### Implementation for User Story 3

- [ ] T131 [US3] `POST /runs/:id/pause|resume|cancel` routes + worker job control signals in
      `apps/api/src/routes/run-control.ts` and `apps/worker/src/jobs/control.ts` (depends on T096)
- [ ] T132 [US3] `POST /runs/:id/regenerate` route (launch new run from stored snapshot+seed) in
      `apps/api/src/routes/run-regenerate.ts` (depends on T103)
- [ ] T133 [US3] `DELETE /runs/:id/outputs` route (remove volume dir, stamp
      `outputs_deleted_at`) in `apps/api/src/routes/run-outputs.ts` (FR-033a)
- [ ] T134 [P] [US3] Inspector aggregate: volume-over-time + seasonality overlay in
      `apps/api/src/services/inspector/volume-over-time.ts`
- [ ] T135 [P] [US3] Inspector aggregate: per-category amount distributions in
      `apps/api/src/services/inspector/amount-distributions.ts`
- [ ] T136 [P] [US3] Inspector aggregate: persona activity heatmap in
      `apps/api/src/services/inspector/persona-heatmap.ts`
- [ ] T137 [P] [US3] Inspector aggregate: fraud-injection timeline in
      `apps/api/src/services/inspector/fraud-timeline.ts`
- [ ] T138 [P] [US3] Inspector aggregate: imperfection audit in
      `apps/api/src/services/inspector/imperfection-audit.ts`
- [ ] T139 [US3] `GET /runs/:id/inspector/*` routes wiring T134–T138 in
      `apps/api/src/routes/inspector.ts`
- [ ] T140 [US3] `GET /runs/compare` route in `apps/api/src/routes/run-compare.ts`
- [ ] T141 [US3] WS `runs/:id/progress` channel (per-partition tick + status transitions) in
      `apps/api/src/ws/run-progress.ts` (depends on T094)
- [ ] T142 [US3] Run list + run detail UI (status, progress bars, throughput, ETA, logs,
      pause/cancel controls) in `apps/web/src/surfaces/run-control/run-list.tsx` and `run-detail.tsx`
      (depends on T141)
- [ ] T143 [US3] Immutable run-record view (spec snapshot + seed + report + outputs links,
      regenerate button) in `apps/web/src/surfaces/run-control/run-record.tsx` (depends on T132)
- [ ] T144 [P] [US3] World inspector: volume-over-time + seasonality overlay chart (Recharts) in
      `apps/web/src/surfaces/world-inspector/volume-chart.tsx`
- [ ] T145 [P] [US3] World inspector: amount-distributions-per-category chart in
      `apps/web/src/surfaces/world-inspector/amount-distributions.tsx`
- [ ] T146 [P] [US3] World inspector: persona activity heatmap in
      `apps/web/src/surfaces/world-inspector/persona-heatmap.tsx`
- [ ] T147 [P] [US3] World inspector: fraud-injection timeline in
      `apps/web/src/surfaces/world-inspector/fraud-timeline.tsx`
- [ ] T148 [P] [US3] World inspector: imperfection audit view in
      `apps/web/src/surfaces/world-inspector/imperfection-audit.tsx`
- [ ] T149 [US3] Realism-report rendering (distribution summaries, inter-arrival stats,
      achieved-vs-target, seasonality effect sizes, benchmark comparisons with sources) in
      `apps/web/src/surfaces/world-inspector/realism-report.tsx` (depends on T090)
- [ ] T150 [US3] Side-by-side run comparison view in
      `apps/web/src/surfaces/world-inspector/run-compare.tsx` (depends on T140)
- [ ] T151 [US3] Version-history per-version comparison UI in the scenario workspace in
      `apps/web/src/surfaces/scenario-workspace/version-history.tsx` (depends on T032, T100)
- [ ] T152 [US3] CLI commands `txloom run pause|resume|cancel|regenerate|status` in
      `apps/cli/src/commands/run-control.ts`

**Checkpoint**: User Stories 1–3 all independently functional.

---

## Phase 6: User Story 4 - Continue the same world as a live stream at controlled rate (Priority: P4)

**Goal**: History phase continues as a live stream into Kafka/RabbitMQ/webhooks at a controlled,
live-adjustable rate with backpressure and a real-time console — same world state, no reset.

**Independent Test**: Run a history-then-stream scenario, verify the live phase continues the same
personas/world state, verify delivered throughput tracks the configured rate, change the rate live,
and pause/resume the stream.

### Tests for User Story 4 (write first, Constitution Principle III) ⚠️

- [ ] T153 [P] [US4] Contract test: stream `start/pause/resume/stop`, `PATCH target_tps`,
      `GET` stream state in `apps/api/tests/contract/test_stream.ts`
- [ ] T154 [P] [US4] Integration test (Testcontainers Kafka): sustained delivery converges on
      target TPS within tolerance in `apps/worker/tests/integration/kafka-stream.test.ts` (SC-007)
- [ ] T155 [P] [US4] Integration test (Testcontainers RabbitMQ): publisher confirms drive
      backpressure in `packages/sinks/tests/integration/rabbitmq-backpressure.test.ts`
- [ ] T156 [P] [US4] Integration test: webhook sink retries with exponential backoff on failure in
      `packages/sinks/tests/integration/webhook-retry.test.ts`
- [ ] T157 [P] [US4] Property test: history phase → live phase continues the same population/actor
      state with zero discontinuity in `packages/engine/tests/property/continuity.test.ts` (SC-006)

### Implementation for User Story 4

- [ ] T158 [P] [US4] Kafka sink: producer with configurable partitioning, delivery-report-driven
      backpressure in `packages/sinks/src/kafka/producer.ts` (D8)
- [ ] T159 [P] [US4] RabbitMQ sink: publisher with confirm-channel wrapper, reconnect, configurable
      exchange/routing in `packages/sinks/src/rabbitmq/publisher.ts` (D9)
- [ ] T160 [P] [US4] Webhook sink: plain HTTP POST with exponential-backoff+jitter retries (5
      attempts default) in `packages/sinks/src/webhook/publisher.ts` (D15)
- [ ] T161 [US4] Token-bucket rate limiter owned by the stream-drive job, shared across partitions,
      in `packages/engine/src/streaming/token-bucket.ts` (D16)
- [ ] T162 [US4] `stream-drive` BullMQ job: continues the same world state into the live phase,
      meters via the token bucket, publishes achieved/target/lag/backpressure gauges in
      `apps/worker/src/jobs/stream-drive.ts` (depends on T075, T158–T161; FR-029)
- [ ] T163 [US4] Parallel label channel: opt-in dedicated topic/queue for streamed truth labels in
      `apps/worker/src/jobs/stream-label-channel.ts` (FR-030a)
- [ ] T164 [US4] Streams repository + stream lifecycle state machine
      (`idle→streaming⇄paused→stopped`) in `apps/api/src/db/repositories/streams.ts`
- [ ] T165 [US4] `POST /runs/:id/stream/start|pause|resume|stop`, `PATCH /runs/:id/stream`,
      `GET /runs/:id/stream` routes in `apps/api/src/routes/stream-control.ts` (depends on T164)
- [ ] T166 [US4] WS `runs/:id/stream` channel (`achieved_tps/target_tps/sink_lag/backpressure` @1Hz
      + ticker sample) in `apps/api/src/ws/run-stream.ts` (depends on T162)
- [ ] T167 [US4] Stream console UI (rate dial, live achieved-vs-target throughput, sink lag/
      backpressure indicators, real-time event ticker) in
      `apps/web/src/surfaces/stream-console/stream-console.tsx` (depends on T166)
- [ ] T168 [US4] CLI command `txloom stream start|pause|resume|stop|set-rate` in
      `apps/cli/src/commands/stream.ts`
- [ ] T169 [US4] Demo-broker compose profile wiring (local Kafka + RabbitMQ) for the streaming demo
      in `docker-compose.yml` (`demo-brokers` profile, per quickstart.md)

**Checkpoint**: User Stories 1–4 all independently functional.

---

## Phase 7: User Story 5 - Explore ground truth and control label exports (Priority: P5)

**Goal**: Filter the world by fraud typology, drill into a fraud actor's story timeline, and control
label exports with an explicit merge warning.

**Independent Test**: Filter events by typology, open an actor's timeline and verify it renders the
typology's multi-step sequence, export with labels merged and verify the warning, export with the
separate answer key and verify no label fields leak into the main export.

### Tests for User Story 5 (write first, Constitution Principle III) ⚠️

- [ ] T170 [P] [US5] Contract test: `GET /runs/:id/truth/actors/:actorId/story` ordered campaign
      steps in `apps/api/tests/contract/test_actor_story.ts`
- [ ] T171 [P] [US5] Contract test: export with `include_labels:true` requires
      `acknowledged_warning:true` else `422` in
      `apps/api/tests/contract/test_export_warning.ts` (FR-022)
- [ ] T172 [P] [US5] Component test: export controls surface the label-inclusion warning and block
      submit without acknowledgment in `apps/web/tests/export-controls.test.tsx`

### Implementation for User Story 5

- [ ] T173 [US5] `GET /runs/:id/truth/actors/:actorId/story` route: ordered `campaign_step`
      sequence per actor in `apps/api/src/routes/actor-story.ts` (depends on T088)
- [ ] T174 [US5] Ground-truth explorer UI: typology filter + matching events/actors list in
      `apps/web/src/surfaces/ground-truth/explorer.tsx` (depends on T106)
- [ ] T175 [US5] Actor-story timeline UI (multi-step sequence, e.g. dormancy → credential-change →
      drain) in `apps/web/src/surfaces/ground-truth/actor-story.tsx` (depends on T173)
- [ ] T176 [US5] Export controls UI: format selection, include-labels toggle with explicit-warning
      acknowledgment gate in `apps/web/src/surfaces/ground-truth/export-controls.tsx` (depends on
      T107, T171)
- [ ] T177 [US5] CLI command `txloom truth filter|actor-story` in
      `apps/cli/src/commands/truth.ts`

**Checkpoint**: User Stories 1–5 all independently functional.

---

## Phase 8: User Story 6 - Operate everything from the studio, configure nothing on disk (Priority: P6)

**Goal**: Manage sink connections, browse and clone templates, set global defaults, and confirm
zero-config single-command self-hosted operation.

**Independent Test**: From a fresh install started with a single command, add a streaming
destination and a webhook endpoint via the UI, test both connections, clone a template into a new
scenario, and run it — without touching any file on disk.

### Tests for User Story 6 (write first, Constitution Principle III) ⚠️

- [ ] T178 [P] [US6] Contract test: sink-connection CRUD + test-connection action in
      `apps/api/tests/contract/test_sinks.ts`
- [ ] T179 [P] [US6] Contract test: `GET /templates`, `POST /scenarios {template_slug}` clone in
      `apps/api/tests/contract/test_templates.ts`
- [ ] T180 [P] [US6] Contract test: `GET/PUT /settings` in
      `apps/api/tests/contract/test_settings.ts`
- [ ] T181 [P] [US6] Integration test: fresh `docker compose up` reaches a healthy studio within
      the documented time budget in `benchmarks/smoke/install-smoke.test.ts` (SC-003)

### Implementation for User Story 6

- [ ] T182 [US6] Sink-connection repository + credential encryption wiring in
      `apps/api/src/db/repositories/sink-connections.ts` (depends on T047)
- [ ] T183 [US6] `GET/POST /sinks`, `GET/PATCH/DELETE /sinks/:id` routes, secrets write-only, in
      `apps/api/src/routes/sinks.ts` (depends on T182)
- [ ] T184 [US6] `POST /sinks/:id/test` route dispatching to each sink plugin's test-connection in
      `apps/api/src/routes/sink-test.ts` (depends on T053, T158–T160)
- [ ] T185 [US6] Template-seed migration for the four gallery templates (UPI-style, card-present
      retail, mobile money, marketplace payouts) with `benchmark_refs` in
      `apps/api/src/db/migrations/009_seed_templates.ts` (depends on T040; FR-007)
- [ ] T186 [US6] `GET /templates` route + `POST /scenarios {template_slug}` clone-into-scenario path
      in `apps/api/src/routes/templates.ts` (extends T099; depends on T185)
- [ ] T187 [US6] `GET/PUT /settings` route in `apps/api/src/routes/settings.ts`
- [ ] T188 [US6] Connections & settings: sink management with test-connection buttons + credential
      forms in `apps/web/src/surfaces/settings/sink-management.tsx` (depends on T183, T184)
- [ ] T189 [US6] Connections & settings: global-defaults form in
      `apps/web/src/surfaces/settings/global-defaults.tsx` (depends on T187)
- [ ] T190 [US6] Template gallery UI: browse + clone-into-scenario in
      `apps/web/src/surfaces/scenario-workspace/template-gallery.tsx` (depends on T186)
- [ ] T191 [US6] CLI command `txloom sinks list|add|test` in
      `apps/cli/src/commands/sinks.ts`
- [ ] T192 [US6] Single documented install command validated end-to-end against
      `docker-compose.yml`; README/quickstart cross-check (SC-003)

**Checkpoint**: All 6 user stories independently functional; zero-config self-hosted operation
confirmed.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Definition-of-done items spanning every story.

- [ ] T193 [P] 1,000 TPS sustained Kafka benchmark script + published README numbers in
      `benchmarks/kafka/bench.ts` (FR-041, D8)
- [ ] T194 [P] CI smoke benchmark (reduced scale) with regression threshold in
      `benchmarks/kafka/bench-smoke.ts`, wired into `pnpm bench:smoke`
- [ ] T195 [P] Golden-master CI job failing on output drift (wired into CI config / `pnpm test`)
- [ ] T196 [P] Extension/contribution guidance for sinks/typologies/imperfections plugin interfaces
      in `CONTRIBUTING.md` and `docs/extending.md` (FR-027)
- [ ] T197 [P] Apache-2.0 `LICENSE` + README competitive-positioning section (FR-040)
- [ ] T198 [P] Security-hardening doc: secrets never echoed, instance-key rotation, no-auth
      trust-boundary statement in `docs/security.md` (depends on T047)
- [ ] T199 Run `quickstart.md` validation end-to-end (manual QA pass matching its documented steps)
- [ ] T200 [P] Additional React component tests for version-history and template-gallery surfaces
      in `apps/web/tests/version-history.test.tsx` and `template-gallery.test.tsx`
- [ ] T201 [P] Review published `docs/agent/` output against the FR-009 sufficiency bar (an agent
      must author a valid spec without reading product source code)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3–8)**: All depend on Foundational completion.
  - US1 (P1): No dependency on other stories — the MVP core.
  - US2 (P2): Depends on US1's scenario/spec/run/export routes existing to wrap with MCP tools
    (T118–T120 extend T099/T100/T103–T105/T107); no dependency on US3–US6.
  - US3 (P3): Depends on US1's run/generation infrastructure (T094, T096); independent of US2/US4–6.
  - US4 (P4): Depends on US1's partitioning/world-state (T075) and the sink interface (T053);
    independent of US2/US3/US5/US6.
  - US5 (P5): Depends on US1's label emission (T088) and export service (T107); independent of
    US2–US4/US6.
  - US6 (P6): Depends on US1's secrets helper (T047) and sink interface (T053); independent of
    US2–US5.
- **Polish (Phase 9)**: Depends on all desired user stories being complete.

### Within Each User Story

- Tests are written and MUST fail before implementation (Constitution Principle III).
- Engine primitives before orchestration before emission before worker jobs before API routes
  before UI/CLI.
- Story complete before moving to the next priority (if working sequentially).

### Parallel Opportunities

- All Setup tasks marked `[P]` run in parallel once T001 creates the directory skeleton.
- All Foundational `[P]` tasks run in parallel within their sub-group (types/schema, invariants,
  migrations, plugin wiring) once their direct dependency lands.
- Once Foundational completes, US1, US2, US3, US4, US5, and US6 test-writing can start in parallel
  across a team, though US2/US3/US4/US5/US6 implementations reach into US1's routes/services.
- Within US1: all engine-primitive tasks (T070–T073, T076–T079, T081–T085) are `[P]`; all file-sink
  writers (T091–T093) are `[P]`; all inspector aggregates in US3 (T134–T138) are `[P]`.

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests together (before implementation):
Task: "Contract test for POST/GET /scenarios... in apps/api/tests/contract/test_scenarios.ts"
Task: "Contract test for POST /spec/validate... in apps/api/tests/contract/test_spec_validate.ts"
Task: "Golden-master test in packages/engine/tests/golden-master/reference-scenario.test.ts"
Task: "Property test in packages/engine/tests/property/determinism.test.ts"

# Launch independent engine primitives for US1 together:
Task: "Consumer archetype model in packages/engine/src/population/consumer-archetypes.ts"
Task: "Merchant category model in packages/engine/src/population/merchants.ts"
Task: "Card-testing typology in packages/engine/src/fraud/card-testing.ts"
Task: "Account-takeover typology in packages/engine/src/fraud/account-takeover.ts"
Task: "Refund-abuse typology in packages/engine/src/fraud/refund-abuse.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run the Independent Test for US1 (spec → run → labeled files → determinism
   check)
5. Deploy/demo if ready — this is already a usable product per spec.md

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → validate independently → MVP demo (deterministic labeled dataset)
3. US2 → validate independently → agent-authoring demo
4. US3 → validate independently → run control + world inspector demo
5. US4 → validate independently → history-to-live streaming "30-second wow moment"
6. US5 → validate independently → ground-truth explorer + export safety demo
7. US6 → validate independently → zero-config self-hosted operation demo
8. Phase 9 → polish, benchmarks, licensing, docs review

### Parallel Team Strategy

With multiple developers, after Foundational completes:

- Developer A: US1 (engine + core API) — the long pole; others depend on its routes/services
- Developer B: US2 (agent-tools/MCP) once US1's scenario/run/export routes stabilize
- Developer C: US4 (sinks + streaming) in parallel with US1's later tasks, using the sink interface
  from Foundational (T053)
- US3, US5, US6 slot in as capacity frees up; each only needs specific US1 outputs (noted above),
  not all of US1

---

## Notes

- `[P]` tasks touch different files with no incomplete-task dependency.
- `[Story]` labels map every user-story-phase task to spec.md's US1–US6 for traceability.
- Constitution Principle III requires tests before implementation for every engine, validator, and
  API task above — write them first and watch them fail before starting the paired implementation
  task.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
- Avoid: vague tasks, same-file conflicts inside a `[P]` group, cross-story dependencies that break
  independent testability.
