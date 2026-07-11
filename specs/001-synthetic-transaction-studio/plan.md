# Implementation Plan: TxLoom — Synthetic Transaction Studio (v1)

**Branch**: `001-synthetic-transaction-studio` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-synthetic-transaction-studio/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build TxLoom v1: a self-hosted payments world simulator with a deterministic, seeded generation
engine (persona agents, three fraud typologies, four labeled imperfection types over a virtual
clock), a spec-first architecture (JSON Schema + semantic invariants + LLM compile/repair and
diff-based NL edits), four delivery sinks (files, Kafka, RabbitMQ, signed webhooks) with
history-to-live streaming continuity at controlled TPS, a per-run realism report, and a six-surface
React studio — all behind one Fastify REST/WebSocket API consumed identically by the web UI and
CLI, shipped as one `docker compose up`. Technical approach and stack were fixed by user interview
(see research.md): TypeScript end to end, Fastify, MySQL via Knex (no ORM), BullMQ + Redis,
Vite SPA, Vitest, pnpm monorepo.

## Technical Context

**Language/Version**: TypeScript 5.x (strict) on Node.js 22 LTS, end to end

**Primary Dependencies**: Fastify (REST + WebSocket, Ajv-based JSON Schema validation), BullMQ
(job queue), Knex (MySQL migrations + query building — no ORM), React 18 + Vite + Recharts +
Monaco editor (SPA), piscina (`worker_threads` pool), d3-random over a seeded PRNG (pure-rand)
for deterministic distributions, @confluentinc/kafka-javascript (Kafka), amqplib (RabbitMQ),
@dsnp/parquetjs (Parquet), official Anthropic SDK + OpenAI-compatible client (optional LLM
features)

**Storage**: MySQL 8 for scenarios/spec versions/run metadata/sink connections/settings (via
Knex, no ORM); Redis for BullMQ queues only; a Docker volume filesystem for run outputs (truth
store, exports, answer keys, realism report JSON)

**Testing**: Vitest everywhere; fast-check for statistical property tests; golden-master fixtures
(committed reference outputs keyed to seed+spec) for the engine; Testcontainers for MySQL, Redis,
Kafka, and RabbitMQ integration tests; contract tests per REST/WS endpoint; React component tests
for diff-review, spec-editor, and export surfaces

**Target Platform**: Self-hosted Linux/macOS via a single `docker compose up` (API+SPA container,
worker container, MySQL, Redis; Kafka/RabbitMQ are user-provided external targets, with optional
compose profiles for local demo brokers)

**Project Type**: pnpm workspace monorepo — web service + SPA + CLI + library packages

**Performance Goals**: Sustained 1,000 events/sec to Kafka with flat memory (published,
reproducible benchmark — part of v1 definition of done); streaming holds configured TPS within
±5% over a 1-hour window; reference scenario (200k consumers / 5k merchants / 90 days) completes
within the documented envelope; CI benchmark smoke test with regression threshold

**Constraints**: Byte-identical determinism for same seed + spec (per-partition RNG streams; no
`Math.random`, no wall-clock reads in generation logic); LLM never generates transactions and the
product is fully functional without one; truth records immutable (imperfections corrupt delivered
copies only); no auth in v1 (trusted network), secrets encrypted at rest; run outputs retained
until manual delete with metadata preserved for regeneration; labels excluded from main exports by
default (explicit warning to include); single currency per scenario

**Scale/Scope**: 6 UI surfaces, ~15 REST resources + 2 WS channels, 3 fraud typologies, 4 sinks,
4 imperfection types, 4 scenario templates; reference scale 200k consumers / 5k merchants / 90
days / low-millions of events per run; 8-week roadmap with documented de-scope order

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.0.2 — five gates instantiated for this feature:

| # | Gate | How this plan satisfies it | Status |
|---|------|---------------------------|--------|
| 1 | Static (strict TS, zero warnings) | `tsconfig` strict + shared lint/format config at workspace root; `any` prohibited except at validated boundaries (spec input via Ajv, sink payloads); extension points (sinks, typologies, imperfections) are plugin interfaces in `packages/` | PASS |
| 2 | Test gate (test-first) | Engine/validator/API code developed red→green with tests in same PR: golden-master suites (seed+spec → committed reference output), fast-check property tests with tolerance bounds for statistical targets, contract tests per endpoint, Testcontainers integration tests for Kafka/RabbitMQ/MySQL/webhooks; UI component tests for diff-review, spec-editor, export surfaces | PASS |
| 3 | Determinism gate | Single seeded RNG entry (pure-rand) with per-partition substreams; d3-random distributions take the seeded source; virtual clock injected, wall-clock banned in engine; LLM confined to `packages/llm` (spec compile/diff only); golden-master CI job fails on output drift; output-altering changes require declared breaking version | PASS |
| 4 | Performance gate | 1,000 TPS Kafka benchmark script in repo, published numbers in README; CI smoke benchmark (reduced scale) with regression threshold; CPU-bound generation in piscina worker threads, never on the API event loop; streaming metrics (achieved-vs-target, lag, backpressure) exposed | PASS |
| 5 | Review gate | PR review checklist references this table; violations require Complexity Tracking entry below | PASS |

Principle-level checks: spec-as-source-of-truth honored (all state flows from validated spec;
FR-001); UI/CLI are pure clients of one Fastify API (Principle IV); `docker compose up`
single-command distribution preserved (MySQL + Redis + app containers only — no new services
added); engine works without LLM (Principle: openness).

**Post-design re-evaluation (after Phase 1)**: PASS — data model contains no authoritative state
that bypasses the spec (spec snapshots stored verbatim per run); contracts expose every UI
capability (Principle IV parity verified against the six surfaces); no gate violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/001-synthetic-transaction-studio/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── api.md           # REST + WebSocket contract (single API surface)
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/
├── api/                     # Fastify service: REST + WebSocket, serves built SPA, enqueues jobs
│   ├── src/
│   │   ├── routes/          # scenarios, specs, runs, streams, sinks, settings, templates, exports
│   │   ├── ws/              # run-progress + stream-console channels
│   │   ├── services/        # orchestration over packages/* and Knex repositories
│   │   ├── db/              # Knex config, migrations/, repositories (hand-written SQL builders)
│   │   └── plugins/         # Ajv schemas, error mapping, static SPA serving
│   └── tests/               # contract/ + integration/ (Testcontainers)
├── worker/                  # BullMQ consumers: run partitions via piscina worker threads
│   ├── src/
│   │   ├── jobs/            # generate-partition, stream-drive, report-build
│   │   └── pool/            # piscina wiring, checkpointing, idempotent resume
│   └── tests/
├── web/                     # React 18 + Vite SPA — six surfaces
│   ├── src/
│   │   ├── surfaces/        # scenario-workspace/ run-control/ stream-console/
│   │   │                    # world-inspector/ ground-truth/ settings/
│   │   ├── components/      # Monaco spec editor, diff review, charts (Recharts), tickers
│   │   ├── api/             # typed client over contracts (REST + WS)
│   │   └── app/             # shell, routing, theme
│   └── tests/               # component tests (diff-review, spec-editor, export controls)
└── cli/                     # thin automation client over the same API
    ├── src/
    └── tests/

packages/
├── spec/                    # spec types, JSON Schema, semantic invariants, located errors, differ
│   ├── src/
│   └── tests/               # invariant reject+explanation tests (both cases per invariant)
├── engine/                  # deterministic world model: virtual clock, RNG streams, personas,
│   │                        # merchants, seasonality, fraud actors/typologies, imperfection layer,
│   │                        # partitioning, truth-record emission, realism-report computation
│   ├── src/
│   └── tests/               # golden-master/ + property/ (fast-check)
├── sinks/                   # sink plugin interface + file/kafka/rabbitmq/webhook implementations,
│   │                        # TPS control, backpressure, parallel label channel
│   ├── src/
│   └── tests/               # Testcontainers integration
└── llm/                     # provider adapters (Anthropic, OpenAI-compatible), compile + diff
    │                        # prompting, validation/repair loop driver — never touches the engine
    ├── src/
    └── tests/

benchmarks/                  # 1,000 TPS Kafka benchmark + CI smoke variant
docker-compose.yml           # api, worker, mysql, redis (+ optional demo kafka/rabbitmq profiles)
pnpm-workspace.yaml
```

**Structure Decision**: pnpm workspace monorepo (user-selected). Library packages (`spec`,
`engine`, `sinks`, `llm`) isolate the deterministic core from delivery and from the optional LLM;
apps (`api`, `worker`, `web`, `cli`) are thin hosts. The API serves the built SPA so compose
stays at four containers.

## Complexity Tracking

> No constitution violations — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
