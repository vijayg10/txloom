# Implementation Plan: Generation-to-Delivery Overhaul

**Branch**: `003-generation-delivery-overhaul` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-generation-delivery-overhaul/spec.md`, derived
from an architecture review of the generation-to-delivery flow (gaps G1–G16, U1–U3 and the
Kafka configuration gaps in §4).

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

The work makes every v1 promise about the path from generation to delivery true at reference
scale. It has four strands.

1. **Reproducibility first.**
   - Runs record `engine_version` and `partition_count`.
   - Seeds become exact 64-bit strings.
   - Every pull request that changes generated output bumps `ENGINE_VERSION` by one, and
     the golden-master gate enforces it. The released version jumps from 1 to the final
     number of this feature.
2. **One day-at-a-time world simulator** replaces build-everything-then-sort generation.
   - `simulateDay(world, d)` feeds incremental Parquet writers, so memory stays flat.
   - Fraud campaigns are planned up front (refund abuse in O(1), staggered account-takeover
     anchors, enforced dormancy), and a daily activity curve shapes the hours.
   - The world is checkpointed at the end of history. Live mode continues the *same function*
     on days `D, D+1, …` in a dedicated thread, paced by target TPS.
   - Imperfections become a per-event transformer shared by history and live, so every sink
     really carries its labeled corruptions.
3. **Connections and destinations replace inline sinks.**
   - Typed Kafka, RabbitMQ and webhook connections, including SASL_SSL with SCRAM and a CA.
   - Connections are tested from the worker before saving.
   - Destinations are bound per run and remembered per scenario.
   - History replay to brokers is optional and off by default (FR-021, clarified as option C).
   - Live starts automatically for `history_then_live` runs.
   - A shared `DeliveryPump` provides bounded in-flight publishing, acknowledgement-based
     success, AIMD backpressure, retry heaps, `dropped` delivery outcomes and a breaker.
4. **UI rebuilt around "where should the events go?"**
   - A Launch drawer on the scenario page.
   - A Connections page.
   - One run page with tabs: Progress · Live · Inspect · Ground truth · Export.
   - A two-click first run against the auto-registered `local-kafka`.
   - Built prototype-first against a mock API adapter, as the review's §7 recommends.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS, end to end. This is unchanged.

**Primary Dependencies**: All existing; there are **no new runtime dependencies**.

- Fastify with Ajv; BullMQ 5; Knex with mysql2.
- piscina for partition generation, plus `node:worker_threads` directly for the long-lived
  live-world thread.
- pure-rand: `xoroshiro128plus.fromState` with SplitMix64 seeding.
- `@confluentinc/kafka-javascript`, configured through librdkafka top-level properties:
  `security.protocol`, `sasl.mechanisms`, `ssl.ca.pem`, and `AdminClient.createFrom` for
  probes.
- amqplib through a confirm channel.
- `@dsnp/parquetjs`, writing incrementally with `appendRow` and `setRowGroupSize`.
- React 18, React Router and Vite on the web side; `@modelcontextprotocol/sdk`.

**Storage**:

- MySQL 8, through Knex migrations `010`–`014`:
  - `sink_connections` is renamed to `connections`, with typed config;
  - new tables `run_destinations`, `scenario_destination_defaults`, `run_deliveries` and
    `stream_sessions`;
  - new run and partition columns.
- Redis, for BullMQ only.
- The data volume, with a new run-output layout: aligned label files, `corruptions/`,
  `deliveries/` and gzipped world `checkpoints/` (data-model.md §3).

**Testing**:

- Vitest, with fast-check property tests and golden masters. The golden master gains:
  - the new engine's history output, re-baselined with each version bump;
  - history-plus-live equivalence: days `0..D−1` followed by live days `D..` must equal one
    uninterrupted simulation.
- Contract tests for every new or changed endpoint and MCP tool.
- Testcontainers integration tests:
  - Kafka with SASL_SSL, SCRAM-SHA-512 and a self-signed CA;
  - Kafka throttled;
  - RabbitMQ blocked;
  - a webhook server that hangs or returns 429 or 500.
- Component tests (Launch drawer, connection form, run tabs) running on the mock adapter.
- The specs/002 Playwright e2e suite, updated to `contracts/ui-routes.md`.

**Target Platform**: Self-hosted with `docker compose up`, plus the optional `demo-brokers`
profile. This is unchanged, and no new compose service is added.

**Project Type**: pnpm workspace monorepo: web service, SPA, CLI and library packages
(unchanged).

**Performance Goals** (budgets, from spec SC-006 to SC-014):

| Budget | Target |
| --- | --- |
| Reference batch run (200k consumers × 5k merchants × 90 days, all typologies and imperfections) | under 30 min on 8 vCPU / 16 GB |
| Peak memory per generating partition | under 1 GB; growth from 30 to 90 days ≤ 10% |
| Refund-abuse generation when the population doubles | ≤ 2.5× slower |
| Live stream start at reference scale | under 30 s |
| Kafka at 1,000 events/s for 30 min | within ±5% in ≥ 99% of 1-second windows |
| API event-loop stall on launch, resume or stream start | none over 100 ms |

**Constraints**:

- Byte-identical output for the same spec, seed and engine version.
- No wall-clock reads in the engine: live pacing maps simulated time to wall time in the
  pump, not in the engine.
- No secrets in specs, run records, job payloads or logs. Probe payloads are sealed with the
  instance key.
- v1 scope stays at 3 typologies, 4 sinks and 4 imperfection types. A failed delivery is
  recorded in a separate `delivery_outcome` field (`dropped`), not as a fifth
  `corruption_type`; see the Constitution Check.
- CPU-bound export building runs in a worker job, never on the API event loop (R19).

**Scale/Scope**:

- About 60 source files touched across `packages/engine`, `packages/sinks`,
  `packages/agent-tools`, `apps/api`, `apps/worker`, `apps/web`, `apps/cli` and `apps/e2e`.
- 5 migrations; about 14 new or changed endpoints; 3 new MCP tools.
- 3 new top-level routes, plus the run tabs.
- 9 user stories, delivered in 6 increments (see Delivery sequencing).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.1.0. The five quality gates, applied to this feature:

| # | Gate | How this plan satisfies it | Status |
|---|------|---------------------------|--------|
| 1 | **Static** (strict TS, zero warnings) | Typed connection configs, generated from the factory `configSchema`s, replace `unknown` configs. `any` appears only at the Ajv boundary for connection bodies and probe payloads. A new lint rule bans in-app `<a href>`. | PASS |
| 2 | **Test** (test-first) | Each increment opens with failing tests: golden master (per engine version, plus history+live equivalence); property tests (fraud rate with planned campaigns, imperfection rates, dormancy, daily curve); contract tests (connections, launch, destinations, deliveries, stream sessions, exports, MCP parity); Testcontainers (SCRAM/CA Kafka, blocked RabbitMQ, hanging webhook); component tests (Launch drawer, connection form, export controls); e2e answer-key reconciliation (SC-004). | PASS |
| 3 | **Determinism** | **Declared breaking changes, one per PR.** Every PR that changes generated output bumps `ENGINE_VERSION` by one, re-baselines the golden master (which pins the version) and adds a CHANGELOG entry. That covers seed expansion and named streams, per-day generation and planned fraud, the transformer and wire `ts` semantics, live generation, and the activity curve and dormancy. Golden-master output never changes in a PR without a bump. Old runs stay explainable through `engine_version`. Regenerate refuses or asks for confirmation (R1), and continuation across versions is refused. Live randomness comes only from checkpointed RNG streams; pacing never affects content. | PASS (declared breaking) |
| 4 | **Performance** | The budgets in Technical Context come straight from the spec's success criteria. The reference benchmark runs through the real API and job path (R18). The CI smoke benchmark (20k × 14 days) fails on a regression above 15%. Memory-flatness and refund-scaling checks run in CI. CPU-bound work stays off the API event loop: the merchant pool is removed from the API (R3), live generation runs in its own thread (R5), and exports are built by a worker job (R19). | PASS |
| 5 | **Review** | Each PR links the row of this table it touches. The Complexity Tracking entries below are pre-justified. | PASS |

**Principle-level checks**:

- **I. Extensibility as interfaces.** The sink plugin contract moves to v2
  (`contracts/sink-plugin.md`). It stays one documented interface: retries and backpressure
  move *out* of the sinks into the shared pump, and no conditionals are threaded through the
  engine. v2 is breaking for third-party sinks: it is versioned (`SINK_PLUGIN_API_VERSION`)
  and documented.
- **II. Deterministic.** Truth stays immutable, and the transformer corrupts only delivered
  copies. Imperfection RNGs are separate named streams, so adding or removing a sink never
  changes truth output.
- **IV. One API, three clients.**
  - Every new capability is a REST endpoint first: destinations, connections test,
    suggestions, estimate, retry, deliveries.
  - The MCP tools `list_connections`, `estimate_run` and `retry_run` and the updated
    `launch_run` and `start_stream` map onto them one to one.
  - The CLI follows suit.
  - Errors are located (`details.sink`, `details.violations[]`) and carry a remedy.
  - No configuration file editing is required: `local-kafka` is auto-seeded and
    `TXLOOM_CONNECTIONS_JSON` is optional.
  - Terminology: "destination" is the single term for "this spec sink goes to that
    connection (and topic)", across the UI, CLI (`--dest`), API (`destinations[]`), MCP and
    docs. "Binding" is not used.
- **IV. All configuration operable from the UI.** The Connections page plus Settings cover
  this.
- **V.** Covered by gate 4. Streaming exposes achieved versus target throughput, *real* sink
  lag and backpressure.
- **Spec as source of truth.** The spec's structure is unchanged; only `seed` gains a
  `0…2^53−1` bound and the `seed-out-of-range` invariant (R2), and the current template seed
  (424242) is within it. Destinations and connections are delivery
  infrastructure that never hold generation state. Specs stay address-free and shareable.
- **Distribution.** No new compose service. The live-world thread and the `connection-test`
  and `deliver` queues run inside the existing worker container.

**Post-design re-evaluation (after Phase 1)**: PASS.

- The data model adds no state that bypasses the spec. `run_destinations` is the
  immutable launch-time record; `streams.destinations` (current) and `stream_sessions` /
  `run_deliveries` snapshots only describe delivery.
- The contracts cover every UI capability: Launch, Connections and the run tabs each map to
  endpoints in `contracts/api.md`.
- The `dropped` delivery outcome and the sink v2 interface are justified below.
- No unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-generation-delivery-overhaul/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output: decisions R1–R19
├── data-model.md        # Phase 1 output: migrations 010–014, engine types, output layout
├── quickstart.md        # Phase 1 output: per-story validation runbook
├── contracts/
│   ├── api.md           # REST/WS/MCP/CLI delta against the 001 contract
│   ├── sink-plugin.md   # Sink plugin interface v2 + DeliveryPump semantics
│   ├── wire-format.md   # Delivered payload + label channel (new engine output)
│   └── ui-routes.md     # Routes, redirects, stable data-testids
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/
├── engine/src/
│   ├── version.ts                    # NEW  ENGINE_VERSION (R1)
│   ├── rng.ts                        # SplitMix64 64-bit seeding; hash-seeded deriveNamedRng (R2, R3)
│   ├── world/                        # NEW  per-day simulator (R6)
│   │   ├── partition-world.ts        #      initPartitionWorld / checkpointWorld / restoreWorld (R7)
│   │   ├── simulate-day.ts           #      simulateDay: income, spend, activity curve, dormancy
│   │   ├── activity-curve.ts         #      24-bin hour-of-day alias table
│   │   └── checkpoint-codec.ts       #      gzip JSON + sha256
│   ├── fraud/
│   │   ├── planner.ts                # NEW  per-day campaign planning, pending heap (replaces orchestrator.ts)
│   │   └── refund-abuse.ts …         #      purchase-ring based selection (R6)
│   ├── imperfections/transformer.ts  # NEW  stateful per-sink transformer (R9); pipeline.ts removed
│   ├── streaming/live-world.ts       # rewritten: day iterator + k-way merge over restored worlds
│   ├── estimate.ts                   # NEW  estimateRun (R16)
│   └── truth-emit.ts                 # generatePartition becomes a thin day loop over simulateDay
├── sinks/src/
│   ├── interface.ts                  # Sink v2 (contracts/sink-plugin.md)
│   ├── pump.ts                       # NEW  DeliveryPump (R12)
│   ├── file/parquet.ts               # + ParquetStreamWriter (R8)
│   ├── kafka/producer.ts             # librdkafka security props, ack-resolving publish, AdminClient probe
│   ├── rabbitmq/publisher.ts         # confirm callbacks, drain, TLS
│   └── webhook/publisher.ts          # AbortSignal timeout, no internal retry
├── spec/src/schema.json, invariants/seed-range.ts   # spec.seed bounded to 0…2^53−1 (R2)
└── agent-tools/src/tools.ts          # list_connections, estimate_run, retry_run; launch_run/start_stream/create_export updated

apps/
├── api/src/
│   ├── db/migrations/010…014_*.ts    # NEW  (data-model.md §1)
│   ├── db/repositories/              # connections.ts (renamed), run-destinations.ts, destination-defaults.ts, launch-defaults.ts,
│   │                                 # run-deliveries.ts, stream-sessions.ts; runs.ts/streams.ts updated
│   ├── routes/connections.ts         # NEW  replaces sinks.ts + sink-test.ts (410 shim for /sinks)
│   ├── routes/runs-launch.ts         # LaunchRequest, atomic launch, re-validation, destinations
│   ├── routes/run-control.ts         # + retry, deliveries retry/skip
│   ├── routes/stream-control.ts      # sessions, no inline sink, paused → 409,
│   │                                 #   PUT stream/destinations (current destinations only)
│   ├── routes/run-regenerate.ts      # engine-version policy
│   ├── routes/spec.ts                # + /spec/estimate
│   ├── routes/scenarios.ts, spec-versions.ts  # re-validate on clone / rollback; launch-defaults
│   ├── services/run-launch-service.ts         # no merchant pool, transaction, engine version
│   ├── services/connection-probe.ts  # NEW  enqueue connection-test, sealed secrets, waitUntilFinished
│   ├── services/local-kafka.ts       # NEW  boot probe + suggestions + TXLOOM_CONNECTIONS_JSON (R15)
│   ├── routes/exports.ts             # enqueue export-build (202) + status (R19)
│   ├── services/inspector/*.ts       # read labels/ + corruptions/ layout
│   └── mcp/tools/*.ts                # new + changed tools
├── worker/src/
│   ├── index.ts                      # concurrency, attempts, phase orchestration, boot reconciliation
│   ├── jobs/generate-partition.ts    # concurrency = pool size; UnrecoverableError on version mismatch
│   ├── jobs/deliver.ts               # NEW  history replay via DeliveryPump, cursor checkpoints
│   ├── jobs/stream-drive.ts          # rewritten: session lifecycle, pump, metrics, crash-resume skip
│   ├── jobs/connection-test.ts       # NEW  probe from the worker's network
│   ├── jobs/export-build.ts          # NEW  source selection, aligned-label lockstep merge (R8, R19)
│   ├── live/live-world-thread.ts     # NEW  dedicated worker_thread: day gen + merge + transformer + ring buffer
│   ├── pool/partition-worker.ts      # day loop → streaming writers, transformer, checkpoint
│   └── pool/merchant-cache.ts        # NEW  per-(run, engine version) LRU (R3)
├── web/src/
│   ├── api/mock/                     # NEW  mock adapter (prototype + component tests)
│   ├── components/layout/nav-items.ts, app-shell.tsx   # Scenarios · Runs · Connections; redirects
│   ├── surfaces/home/first-run.tsx   # NEW
│   ├── surfaces/scenario-workspace/launch-drawer.tsx   # NEW (replaces run-control/run-launch.tsx)
│   ├── surfaces/connections/         # NEW  list, typed forms, test-before-save (replaces settings/sink-management.tsx)
│   ├── surfaces/run/                 # NEW  run page shell + tabs; hosts existing run-control,
│   │                                 #      stream-console, world-inspector, ground-truth components
│   └── surfaces/stream-console/stream-launcher.tsx      # REMOVED
├── cli/src/commands/                 # connections-*, run --dest, run-retry; sinks-* removed
└── e2e/src/ui.ts, tests/             # flows rewritten to contracts/ui-routes.md; @answer-key story

benchmarks/
├── batch/bench-reference.ts          # NEW  reference-scale through the API (R18)
├── batch/bench-memory-flatness.ts, bench-refund-scaling.ts   # NEW
└── kafka/                            # drive a real stream session through the API

analytics-flink/jobs/java/…/common/Event.java, CleanAndOrderJob.java, README.md
                                      # read delivered_at (contracts/wire-format.md)
```

**Structure Decision**: The existing pnpm monorepo layout is kept, with no new packages or
apps.

- **Engine.** The per-day simulator goes in `packages/engine/src/world/`, so the
  deterministic core stays isolated and golden-mastered.
- **Sinks.** The delivery pump goes in `packages/sinks`, next to the sinks it drives.
- **Worker.** The live-world thread lives in `apps/worker/src/live/`, beside the jobs that
  own it.
- **Web.** The UI's new surfaces (`connections/`, `run/`, `home/`) *host* the existing
  stream-console, world-inspector and ground-truth components as tabs, rather than rewriting
  them.

## Delivery sequencing

Each increment is independently mergeable and leaves `main` releasable. Every
output-changing PR bumps `ENGINE_VERSION` in that PR (gate 3), so no unbumped output change
ever reaches `main`. The order matches tasks.md: connections come first as the MVP because
they change no output, then versioning, then the output-changing engine work.

| # | Increment | Spec coverage | Output-changing? |
|---|-----------|---------------|------------------|
| 1 | **Connections and destinations (MVP).** Migrations 011, 012; typed configs; Kafka SASL/SCRAM/CA; worker-side probe; `/connections`; destinations on launch and stream; inline sinks removed; MCP and CLI parity | US1, FR-007–012, 015–019 | No (engine v1) |
| 2 | **UI.** Prototype on the mock adapter, reviewed, contract adjusted; then the Launch drawer | US5 (minus replay), FR-045, 046 | No |
| 3 | **Versioning and seeds.** Migration 010 is already in place from Foundational; regenerate and stream policy; 64-bit seeds; hashed named streams | US4, FR-001–006 | **Yes (+1)** |
| 4 | **Reference scale and lifecycle.** Per-day simulator, fraud planner, world checkpoints, parallel partitions, atomic launch, retries, stream sessions, re-validation, merchant pool off the API, benchmarks | US3, FR-026, 027, 029, 033–040 | **Yes (+1)** |
| 5 | **Answer key and delivery.** Transformer, new file layout, Sink v2 and DeliveryPump, replay, `dropped`, export job, wire `delivered_at`, analytics-flink | US2, FR-020, 021, 023, 024 | **Yes (+1)** |
| 6 | **Live and health.** Live-world thread, live continuity, auto-start live, AIMD, breaker, real lag, Kafka benchmark | US6, US7, FR-022, 028, 030–032, 041, 042, 044 | **Yes (+1, live content)** |
| 7 | **Navigation, first run and realism.** Run page, redirects, `local-kafka`, first-run card; activity curve, staggered account-takeover anchors, dormancy, label-merging exports | US8, US9, FR-013, 014, 025, 043, 047–053 | **Yes (+1, realism)** |

Increment 2 can run alongside 3 and 4. Increment 4 must land before 5 and 6, because the
transformer and live continuity depend on the per-day simulator and checkpoints.

## Complexity Tracking

| Violation / added complexity | Why Needed | Simpler Alternative Rejected Because |
|------------------------------|------------|--------------------------------------|
| **Breaking changes to generated output (several engine-version bumps)** (Principle II requires each to be versioned) | G5, G6, G10, G11, G14 and G2 can't be fixed without changing what a seed produces | A single bump would need either a long-lived branch holding about 90 tasks back from `main` (merge risk), or re-baselining without a bump, which the Determinism gate forbids. One bump per output-changing PR keeps every merge compliant; users only see the released version number |
| **Sink plugin interface v2** (breaking for third-party sinks, Principle I) | Ack-resolving, concurrent `publish` and staged `probe` are needed to fix G9 and FR-010. Retries move into the shared pump | Keeping v1 and wrapping it can't give acknowledgement semantics (RabbitMQ confirms were never awaited) or bounded concurrency |
| **`delivery_outcome: "dropped"` in the answer key** (scope discipline: "4 imperfection types") | FR-023 requires failed deliveries to be visible in the answer key. A dropped delivery is a *delivery outcome* recorded by the pump, kept in its own field so `corruption_type` still lists exactly the four injectable imperfections; the spec schema is unchanged | Leaving failed events labeled as delivered breaks SC-004. Writing only a dead-letter file still leaves the answer key wrong. Reusing `corruption_type` would blur the four-type scope limit |
| **A long-lived `worker_threads` thread per active stream**, beside piscina | Live generation (about 0.4 s of CPU per reference-partition day) must not block pacing or BullMQ lock renewal (R5) | Piscina tasks per day would copy world state across threads every day; running on the main thread reproduces G7's stalls |
| **API waits on a worker job for connection tests** | The probe must run where publishing happens (FR-010, the review's localhost trap) | Probing from the API gives false results whenever the networks differ |
