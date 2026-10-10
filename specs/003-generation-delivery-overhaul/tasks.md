---

description: "Task list for 003-generation-delivery-overhaul"
---

# Tasks: Generation-to-Delivery Overhaul

**Input**: Design documents from `/specs/003-generation-delivery-overhaul/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R18), data-model.md, contracts/ (api.md,
sink-plugin.md, wire-format.md, ui-routes.md), quickstart.md

**Tests**: Constitution Principle III makes tests mandatory. Every engine, validator, API,
worker and sink task below has a test task **before** it in the same phase. Write it, see it
fail, then implement. UI visual polish is exempt. Component tests are listed wherever a
surface has behaviour.

**Organization**: Tasks are grouped by user story. Phase order follows the spec's priorities.
Within P1, the order is chosen by dependency: US1 is the MVP because it needs no engine
change. US4 then adds engine versioning, which the output-changing stories US3, US2, US6 and
US9 rely on.

**Engine versioning (constitution, Determinism gate).** Every PR that changes generated
output bumps `ENGINE_VERSION` by one, re-baselines
`packages/engine/tests/golden-master/reference-output.json` (which pins the version) and adds a
CHANGELOG "Engine output changes" entry, all in that same PR. Golden-master output never
changes in a PR without a bump. The bumps in this feature are T058 (seeds and named streams),
T083 (per-day simulator), T114 (transformer), T151 (live generation) and T190 (realism).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US9, from spec.md)
- Paths are repo-relative, following the monorepo layout in plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Test-runner wiring, scripts and changelog that every later phase uses.

- [X] T001 Register the new DB-backed contract test files `test_connections.ts`, `test_destinations.ts`, `test_launch.ts`, `test_estimate.ts`, `test_run_retry.ts`, `test_stream_sessions.ts` and `test_deliveries.ts` (all in `apps/api/tests/contract/`): add each to the `integration` project's `include` and to the `contract` project's `exclude` in `vitest.workspace.ts`.
- [X] T002 [P] Add root scripts to `package.json`:
  - `bench:reference` → `tsx benchmarks/batch/bench-reference.ts`
  - `bench:memory-flatness` → `tsx benchmarks/batch/bench-memory-flatness.ts`
  - `bench:refund-scaling` → `tsx benchmarks/batch/bench-refund-scaling.ts`
  - `bench:batch-smoke` → `tsx benchmarks/batch/bench-smoke.ts`
- [X] T003 [P] Create `CHANGELOG.md` at the repo root with an `## Unreleased` section and four empty subsections: "Engine output changes (breaking; one `ENGINE_VERSION` bump per entry)", "Sink plugin API v2 (breaking)", "Wire format (breaking)" and "API removals". Later tasks append entries to them.
- [X] T004 [P] Create the e2e fixture `apps/e2e/fixtures/imperfections-all.json`. Base it on `apps/e2e/fixtures/tiny-scenario.json`, with:
  - `output.sinks`: `[{type:"file",name:"archive",format:"parquet"}, {type:"kafka",name:"events"}]`;
  - all four imperfections at a rate of 0.05, each targeting both sinks;
  - all three fraud typologies.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Run-schema and engine-version groundwork that every story reads.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [X] T005 Write failing migration tests in `apps/api/tests/integration/db-migrate.test.ts` for migration 010:
  - `runs.engine_version` is backfilled to 1;
  - `runs.partition_count` is backfilled from `COUNT(run_partitions)`;
  - `mode` is mapped `batch`→`history_only` and `batch_then_stream`→`history_then_live`;
  - the new columns `replay_history`, `target_tps`, `label_channel` and `source_run_id` have their defaults;
  - `run_partitions.attempts` and `run_partitions.last_error` exist.
- [X] T006 Implement migration `apps/api/src/db/migrations/010_runs_engine_version.ts` exactly as in data-model.md §1.2–1.3, including the backfill and the ENUM change, and include its `down`.
- [X] T007 Update `apps/api/src/db/repositories/runs.ts` for the new schema:
  - `RunMode = "history_only" | "history_then_live"`;
  - `RunRow` gets `engine_version`, `partition_count`, `replay_history`, `target_tps`, `label_channel` and `source_run_id`;
  - `CreateRunInput` accepts the same fields;
  - `RunPartitionRow` gets `attempts` and `last_error`, and there is a new `recordAttempt(runId, partitionNo, attempts, error)`.
- [X] T008 [P] Create `packages/engine/src/version.ts` exporting `ENGINE_VERSION = 1`, and re-export it from `packages/engine/src/index.ts`.
- [X] T009 Add an `"engine_version": 1` field to `packages/engine/tests/golden-master/reference-output.json`. In `packages/engine/tests/golden-master/reference-scenario.test.ts`, assert that it equals `ENGINE_VERSION`, and fail with the message "output changed: bump ENGINE_VERSION or revert" whenever the output diverges (research R1).
- [X] T010 Move every reader of the old run-mode values to the new enum:
  - `apps/api/src/routes/runs-launch.ts`: accept `batch` and `batch_then_stream`, map them, and set a `Deprecation: true` response header;
  - `apps/api/src/routes/run-regenerate.ts`;
  - `apps/web/src/surfaces/run-control/run-status.ts`;
  - `apps/cli/src/commands/run.ts`;
  - the `launch_run` input schema in `packages/agent-tools/src/tools.ts`.
- [X] T011 [P] Extend the typed web client `apps/web/src/api/client.ts` with these types from contracts/api.md:
  - `Connection`, `ConnectionInput`, `ProbeResult`;
  - `LaunchRequest`, `DestinationInput`, `Destination`, `RunEstimate`;
  - `StreamMetrics`, `StreamSession`;
  - the extended `Run` fields.

  Also expose a `createApiClient()` factory that later returns either the real or the mock adapter.

**Checkpoint**: Foundation ready. US1 and the UI prototype can start; US4 can start in parallel.

---

## Phase 3: UI Prototype (gate for UI tasks in US1, US5 and US8 only)

**Purpose**: The clickable prototype on mocked data from review §7 and research R17. It runs
in parallel with backend work, and it blocks **only** the UI tasks of US1, US5 and US8.
Components built here become the real ones; later phases wire and test them.

- [X] T012 Create the mock adapter in `apps/web/src/api/mock/index.ts`, with fixtures in `apps/web/src/api/mock/fixtures.ts`:
  - it implements the full client surface from T011;
  - fixtures: `local-kafka` and `staging-msk` connections (the latter with a failed test, stage `auth`), three runs in different phases, launch defaults, an estimate, and a ticking `StreamMetrics` generator;
  - `createApiClient()` in `apps/web/src/api/client.ts` returns it when `import.meta.env.VITE_TXLOOM_MOCK === "1"`.
- [X] T013 [P] Build the Connections page: cards with a health indicator in `apps/web/src/surfaces/connections/index.tsx`, and the typed Kafka/RabbitMQ/webhook form in `apps/web/src/surfaces/connections/connection-form.tsx`. Show only the fields that apply, add the localhost warning, use test-before-save, and use the `data-testid`s from contracts/ui-routes.md.
- [X] T014 [P] Build the reusable `DestinationPicker` in `apps/web/src/components/data/destination-picker.tsx`:
  - one row per spec sink, with a connection select plus a `__new__` "New connection…" item and a topic input defaulting to the connection's `default_topic`;
  - file sinks show "File download".
- [X] T015 Build the Launch drawer in `apps/web/src/surfaces/scenario-workspace/launch-drawer.tsx`:
  - it uses `DestinationPicker` (T014), the mode radios, the rate, the Advanced section (seed, label channel, scale, replay history) and the estimate line;
  - "New connection…" opens `connection-form.tsx` (T013) in a nested drawer.
- [X] T016 [P] Build the run page shell with tabs Progress · Live · Inspect · Ground truth · Export in `apps/web/src/surfaces/run/index.tsx`. Include the read-only destination chip `apps/web/src/surfaces/run/destination-chip.tsx`.
- [X] T017 [P] Build the first-run card in `apps/web/src/surfaces/home/first-run.tsx`.
- [X] T018 Wire the prototype navigation in `apps/web/src/components/layout/nav-items.ts` (Scenarios · Runs · Connections, with Settings in the footer) and `apps/web/src/components/layout/app-shell.tsx` (the routes from contracts/ui-routes.md).
- [X] T019 Hold the prototype review. Walk the quickstart flows for US8, US5 and US1 with `VITE_TXLOOM_MOCK=1 pnpm --filter @txloom/web dev`. Record the findings in `specs/003-generation-delivery-overhaul/prototype-review.md`, and apply any agreed changes to `specs/003-generation-delivery-overhaul/contracts/ui-routes.md` and `contracts/api.md` **before** the UI tasks T046–T047 (US1), T143 (US5) and T175–T178 (US8).

**Checkpoint**: The UI contract is frozen, and the UI tasks in US1, US5 and US8 may proceed.

---

## Phase 4: User Story 1 - Stream to my own authenticated Kafka cluster (Priority: P1) 🎯 MVP

**Goal**:
- Named, typed connections, including SASL_SSL with SCRAM and a CA certificate.
- Connections are tested from the worker before saving, and secrets are never shown again.
- Runs and streams send each spec sink to a chosen connection (its destination), and inline broker addresses are gone from every client.

**Independent Test**: Register a SASL_SSL + SCRAM-SHA-512 + CA connection, test it, save it,
launch a run bound to it (UI, CLI or MCP), start the stream, and consume the events from the
chosen topic (quickstart.md § US1).

### Tests for User Story 1 (write first; they must fail) ⚠️

- [X] T020 [P] [US1] Write migration-011 tests in `apps/api/tests/integration/db-migrate.test.ts`:
  - `sink_connections` is renamed to `connections`;
  - `file` rows are deleted;
  - an old Kafka `{brokers, topic}` row with credentials maps to `SASL_SSL` + `PLAIN`, and one without maps to `PLAINTEXT`;
  - a RabbitMQ `url` is split into host, port and vhost, with its userinfo moved into the secrets;
  - an unmappable row is kept with `last_test_ok=false`.
- [ ] T021 [P] [US1] Write contract tests in `apps/api/tests/contract/test_connections.ts`:
  - CRUD;
  - typed validation: `sasl_mechanism` required iff `SASL_*`; `ca_pem` only with SSL or SASL_SSL; a topic regex. Errors return `400 invalid_connection` with JSON-Pointer `details.violations[]`;
  - `409 name_taken`;
  - secrets never appear in any response, only `has_credentials`;
  - PATCH that omits secrets keeps them, and `null` clears them;
  - the `localhost_address` warning;
  - `GET /sinks` returns `410 gone`;
  - `POST /connections/test` persists nothing, and returns `503 worker_unavailable` when no worker consumes the queue;
  - saving after a test that reported a missing topic (auto-create forbidden) succeeds, and the saved connection carries the `topic_missing` warning.
- [ ] T022 [P] [US1] Write the integration test `packages/sinks/tests/integration/kafka-security.test.ts`, using a Testcontainers Kafka with a SCRAM-SHA-512 user over SASL_SSL and a self-signed CA:
  - `probe()` returns `ok` with `stage:"done"` and the topic's partitions;
  - a wrong password gives stage `auth`;
  - a missing CA gives stage `tls`;
  - a missing topic gives `topic.exists=false`; with `auto.create.topics.enable=false` on the broker, the probe also returns `ok:false` with `stage:"topic"`, naming the topic;
  - a `publish` succeeds.
- [ ] T023 [P] [US1] Write the worker integration test `apps/worker/tests/integration/connection-test-job.test.ts`. A `connection-test` job carrying sealed secrets decrypts them with the instance key and probes. Assert that the plaintext password never appears in the Redis job payload: scan `HGETALL` of the job key.
- [ ] T024 [P] [US1] Write contract tests in `apps/api/tests/contract/test_destinations.ts`:
  - launch without a destination for a non-file sink returns `400 sink_without_destination` with `details.sink`;
  - a kafka sink bound to a webhook connection returns `400 destination_type_mismatch`;
  - an unknown `connection_id` returns 400;
  - the destinations are persisted with name and type snapshots;
  - `GET /scenarios/:id/launch-defaults` returns the last destinations;
  - `stream/start` with an inline `sink` returns `400 inline_sink_removed`;
  - a deleted connection gives `409 destination_connection_missing`.
- [ ] T025 [P] [US1] Extend `apps/api/tests/contract/test_mcp_parity.ts`:
  - `list_connections` equals `GET /connections`;
  - `launch_run` with `destinations` is equivalent to the REST call;
  - `start_stream` rejects a `sink` input.
- [ ] T026 [P] [US1] Write the component test `apps/web/tests/connection-form.test.tsx` against the mock adapter:
  - SASL fields are visible only for `SASL_*`;
  - the CA upload is visible only for SSL protocols;
  - Test shows the staged result and is enabled before Save;
  - the password input is empty when editing;
  - the localhost warning appears for `localhost:9092`;
  - a test result with a missing topic shows `conn-topic-missing-warning`, and Save stays enabled.
- [ ] T027 [P] [US1] Write the integration test `apps/api/tests/integration/secret-redaction.test.ts` (FR-009): capture the Fastify logger output and the worker's stdout while creating a SASL connection, testing it, launching a run with a destination on it and starting its stream. Assert that the password and webhook header values never appear in any log line, error message or `GET` response.

### Implementation for User Story 1

- [X] T028 [US1] Implement migration `apps/api/src/db/migrations/011_connections.ts` (data-model.md §1.1), with the config mapping and `managed_by` and `last_test_result` columns.
- [X] T029 [US1] Rename and rewrite `apps/api/src/db/repositories/sink-connections.ts` as `apps/api/src/db/repositories/connections.ts`:
  - typed `ConnectionRow<T>`, `create` and `update` with secret semantics (omitted = keep, `null` = clear);
  - `recordTestResult(id, probe)` stores `last_test_result`;
  - `decryptSecrets(row)` returns the typed secrets.
- [X] T030 [P] [US1] Add a JSON Schema `configSchema` and `secretsSchema` per connection type in `packages/sinks/src/kafka/config.ts`, `packages/sinks/src/rabbitmq/config.ts` and `packages/sinks/src/webhook/config.ts`, as in data-model.md §1.1.1–1.1.2. Expose them on each `SinkFactory`.
- [X] T031 [P] [US1] Add the pure helper `addressWarnings(type, config)` in `packages/spec/src/connection-warnings.ts`, which returns the `localhost_address` warning text from contracts/api.md, and export it from `packages/spec/src/index.ts`.
- [X] T032 [US1] Add `ProbeStage`, `ProbeResult` and `Sink.probe(target)` to `packages/sinks/src/interface.ts`, replacing `testConnection`, as in contracts/sink-plugin.md.
- [X] T033 [US1] Rewrite the Kafka sink constructor and probe in `packages/sinks/src/kafka/producer.ts`:
  - build librdkafka top-level properties: `bootstrap.servers`, `security.protocol`, `sasl.mechanisms`, `sasl.username`, `sasl.password` and `ssl.ca.pem`, outside the `kafkaJS` block (research R10);
  - remove the forced `ssl:true` with SASL PLAIN;
  - implement `probe()` with `KafkaJS.Kafka(...).admin()` / `AdminClient.createFrom(producer)` to fetch topic metadata, partitions, `retention.ms` and `auto.create.topics.enable`, mapping errors to stages. A missing topic on a broker with auto-creation disabled returns `ok:false`, `stage:"topic"` (research R11).
- [X] T034 [P] [US1] Rewrite the RabbitMQ sink connection setup and probe in `packages/sinks/src/rabbitmq/publisher.ts`: build an `amqp(s)://` URL from host, port, vhost and TLS plus the secrets, pass the `ca` buffer, and in `probe()` check the exchange with `checkExchange`.
- [X] T035 [P] [US1] Implement the webhook `probe()` in `packages/sinks/src/webhook/publisher.ts`: a POST of `{}` with `AbortSignal.timeout(config.timeout_ms)`, with secret headers from the secrets, mapping errors to `connect` or `tls`.
- [X] T036 [US1] Add a `connectionTest` queue and a `QueueEvents` instance in `apps/api/src/services/queues.ts`. Implement the worker consumer `apps/worker/src/jobs/connection-test.ts`: unseal the secrets with `decryptSecret` under `getOrCreateInstanceKey(DATA_DIR)`, create the sink through its factory, run `probe(target)`, then `close()`. Register it in `apps/worker/src/index.ts`.
- [X] T037 [US1] Implement `apps/api/src/services/connection-probe.ts`: seal the secrets with `encryptSecret`, enqueue `connection-test` with `removeOnComplete:true`, wait with `job.waitUntilFinished(queueEvents, 15_000)`, and map a timeout to `503 worker_unavailable` with the remedy "start the worker container".
- [X] T038 [US1] Implement `apps/api/src/routes/connections.ts` per contracts/api.md:
  - CRUD with Ajv validation from the factory schemas, plus the conditional rules from T021;
  - `POST /connections/test` and `POST /connections/:id/test`;
  - warnings come from T031, plus `topic_missing` when the stored `last_test_result` reports a missing topic that can't be auto-created;
  - `managed_by:"env"` → 403 on PATCH and DELETE.

  Delete `apps/api/src/routes/sinks.ts` and `apps/api/src/routes/sink-test.ts`, add the 410 `/sinks*` shim, and register the routes in `apps/api/src/app.ts`.
- [X] T039 [US1] Write and implement migration `apps/api/src/db/migrations/012_destinations.ts`: `run_destinations` (immutable after launch, no update path), `scenario_destination_defaults` and `scenario_launch_defaults` (data-model.md §1.4, 1.5, 1.5a). Add the repositories `apps/api/src/db/repositories/run-destinations.ts` (insert and read only), `apps/api/src/db/repositories/destination-defaults.ts` and `apps/api/src/db/repositories/launch-defaults.ts`.
- [X] T040 [US1] Add `apps/api/src/services/destinations.ts` with `validateDestinations(spec, destinations, connections)` and `snapshotDestinations()`. The validation returns `sink_without_destination`, `destination_type_mismatch` and unknown-connection errors with `details.sink`.
- [X] T041 [US1] Extend `POST /scenarios/:id/runs` in `apps/api/src/routes/runs-launch.ts`: accept `destinations`, validate them with T040, persist them through `run_destinations`, upsert `scenario_destination_defaults`, and drop `sink_connection_ids` (accepted with a `Deprecation` header and ignored). Add `GET /scenarios/:id/launch-defaults` there too.
- [X] T042 [US1] Rewrite `POST /runs/:id/stream/start` in `apps/api/src/routes/stream-control.ts`:
  - reject an inline `sink` with `400 inline_sink_removed`;
  - load `run_destinations` and return `409 destination_connection_missing` if a `connection_id` is null;
  - the job payload carries `destinations` (sink name, connection ID, topic, routing key, label topic) and never secrets.
- [X] T043 [US1] Make the worker resolve destinations in `apps/worker/src/jobs/stream-drive.ts`: replace `defaultCreateSink(inline)` with `createSinkForDestination(destination)`, which loads the connection through `ConnectionRepository`, decrypts its secrets, and calls the factory with the destination's target.
- [X] T044 [P] [US1] Update the MCP tools:
  - add `list_connections`; make `launch_run` take `destinations`; remove `sink` from `start_stream` (`packages/agent-tools/src/tools.ts`);
  - register the handlers in `apps/api/src/mcp/tools/read-tools.ts` and `apps/api/src/mcp/tools/run-tools.ts`.
- [X] T045 [P] [US1] Replace the `sinks-*` CLI commands with `apps/cli/src/commands/connections.ts`:
  - `connections-list`, `connections-add` (typed flags; password through a prompt or `--password-stdin`) and `connections-test`;
  - `run --dest sink=connection[:topic]` in `apps/cli/src/commands/run.ts`;
  - remove the broker flags from `apps/cli/src/commands/stream.ts`;
  - update `apps/cli/src/registry.ts`, and delete `apps/cli/src/commands/sinks.ts`.
- [X] T046 [US1] Wire the Connections page (T013) to the real client, and route `/connections` in `apps/web/src/components/layout/app-shell.tsx`.
  - Delete `apps/web/src/surfaces/settings/sink-management.tsx`, including its raw JSON box, and link to Connections from `apps/web/src/surfaces/settings/index.tsx`.
- [X] T047 [US1] Wire `DestinationPicker` (T014) into the current launch page `apps/web/src/surfaces/run-control/run-launch.tsx`, so UI launches send `destinations`; US5 moves this into the drawer.
  - Delete the inline sink form `apps/web/src/surfaces/stream-console/stream-launcher.tsx`, including its e2e defaults. Make `apps/web/src/surfaces/stream-console/stream-console.tsx` start streams with the run's destinations.
- [X] T048 [US1] Rewrite the e2e helpers and stories for connections and destinations: `apps/e2e/src/ui.ts` (the new `conn-*` and `launch-destination-*` test IDs) and `apps/e2e/tests/02-sinks.spec.ts` (create connections on the Connections page, choose them as destinations at launch, consume from Kafka, RabbitMQ and webhook).
- [X] T049 [US1] Add CHANGELOG entries under "API removals" in `CHANGELOG.md`: `/sinks` → `/connections`, inline `sink` on stream start, `sink_connection_ids`, the CLI `sinks-*` commands, and the MCP `start_stream.sink` input.

**Checkpoint**: US1 is complete. An authenticated cluster is reachable end to end; this is the MVP.

---

## Phase 5: User Story 4 - Regenerate exactly the same dataset, or be told why not (Priority: P1)

**Goal**: Runs record their engine version and partition count. Seeds are exact 64-bit
strings with no aliasing. Mismatched versions are refused or need explicit confirmation.
**This phase makes the first engine-version bump (1 → 2).**

**Independent Test**:
- Same spec + seed + engine version produces byte-identical output.
- A version mismatch is surfaced before generating.
- Seeds `"1"` and `"4294967297"` produce different outputs.

(quickstart.md § US4)

### Tests for User Story 4 (write first; they must fail) ⚠️

- [X] T050 [P] [US4] Write the invariant tests in `packages/spec/tests/invariants/harness.test.ts` (both the rejection and the explanation message, per constitution III): `spec.seed` above `2^53−1` or below 0 gives a located violation at `/seed` with code `seed-out-of-range` and the remedy "pass larger seeds as the launch `seed` string"; a seed in range passes.
- [X] T051 [P] [US4] Write RNG tests in `packages/engine/tests/rng.test.ts`:
  - seeds `1n` and `2n**32n + 1n` give different first 1,000 draws;
  - `2n**64n - 1n` is accepted;
  - SplitMix64 state expansion matches published test vectors;
  - `deriveNamedRng(seed, "merchants")` runs in under 1 ms and differs between names and seeds.
- [X] T052 [P] [US4] Write contract tests in `apps/api/tests/contract/test_runs.ts`:
  - seed `"18446744073709551615"` round-trips exactly as a string;
  - a JSON number above 2^53, or `"-1"`, or `"2^64"` returns `400 invalid_seed`, and the message states the range;
  - `GET /runs/:id` includes `engine_version` and `partition_count`.
- [X] T053 [P] [US4] Write contract tests in `apps/api/tests/contract/test_run_control.ts`:
  - regenerating a run with `engine_version ≠ ENGINE_VERSION` returns `409 engine_version_mismatch`, with `details.run_engine_version` and `details.current_engine_version`;
  - with `accept_engine_change:true`, the new run records the new version and `source_run_id`;
  - regenerate reuses the stored `partition_count` even when `TXLOOM_PARTITION_CHUNK_SIZE` changes;
  - stream start and retry on a mismatched run return `409 engine_version_mismatch`.
- [X] T054 [P] [US4] Write the worker test in `apps/worker/tests/integration/generate-run.test.ts`: a `generate-partition` job whose `engineVersion` doesn't match fails immediately as unrecoverable (`attemptsMade === 1`), and the run is `failed` with an error naming both versions.
- [X] T055 [P] [US4] Extend `apps/e2e/tests/04-determinism.spec.ts`: launch with a string seed above 2^53, assert that `engine_version` is recorded, and that a double run is byte-identical.
- [X] T056 [US4] Extend `apps/api/tests/contract/test_runs.ts` (after T052; same file): a launch with no `seed` uses `spec.seed` (two launches without a seed produce the same `seed` and byte-identical truth), and a request `seed` overrides it.

### Implementation for User Story 4

- [X] T057 [US4] Implement 64-bit seeding in `packages/engine/src/rng.ts`:
  - add a `splitmix64(state: bigint)` helper;
  - `createRng(seed)` expands all 64 bits into 4×int32 and uses `prand.xoroshiro128plus.fromState`;
  - `derivePartitionRng` starts from that generator;
  - `deriveNamedRng(seed, name)` seeds directly from `splitmix64(seed ^ fnv1a64(name))`, removing the jump walk (research R2, R3).
- [X] T058 [US4] Bump `ENGINE_VERSION` from 1 to 2 in `packages/engine/src/version.ts` (the first output-changing PR). Re-baseline `packages/engine/tests/golden-master/reference-output.json` (with `engine_version: 2`) and the property-test fixtures in `packages/engine/tests/fixtures.ts`. Add the CHANGELOG "Engine output changes" entry for seed expansion and named streams.
- [X] T059 [US4] Add `parseSeed(input: unknown): bigint` in `apps/api/src/services/seed.ts`. It accepts a decimal string or a safe integer in `[0, 2^64−1]` and otherwise throws a located `invalid_seed` error. In `apps/api/src/routes/runs-launch.ts`, the seed is the request `seed` when given, else `spec.seed`; remove the `Math.random` fallback (research R2). Add a CHANGELOG "API removals" note that launches without a seed now use the spec's seed instead of a random one.
- [X] T060 [US4] Bound `seed` to `0 … 9007199254740991` in `packages/spec/src/schema.json`, and add the invariant `packages/spec/src/invariants/seed-range.ts` (code `seed-out-of-range`, path `/seed`, with the remedy text from T050). Register it in `packages/spec/src/invariants/index.ts`.
- [X] T061 [US4] Serialize `seed` as a string in every run response: `apps/api/src/routes/runs-read.ts`, the launch and regenerate responses, and `apps/api/src/ws/run-progress.ts`.
- [X] T062 [US4] Record `engine_version: ENGINE_VERSION` and `partition_count` at launch in `apps/api/src/services/run-launch-service.ts`. Make `apps/api/src/routes/stream-control.ts`, `apps/api/src/routes/run-control.ts` (resume) and `apps/worker/src/index.ts` (boot resume) use `run.partition_count`, never `defaultPartitionCount`.
- [X] T063 [US4] Implement the regenerate policy in `apps/api/src/routes/run-regenerate.ts`: return 409 `engine_version_mismatch` unless `accept_engine_change`, and set `source_run_id`. Add the version guards that return 409 to stream start in `apps/api/src/routes/stream-control.ts` and to resume in `apps/api/src/routes/run-control.ts`.
- [X] T064 [US4] Add `engineVersion` to the job payloads in `apps/worker/src/jobs/generate-partition.ts` and `apps/worker/src/jobs/stream-drive.ts`. On a mismatch, throw BullMQ's `UnrecoverableError` with a message naming both versions.
- [X] T065 [P] [US4] Add the engine-mismatch dialog to the regenerate action in `apps/web/src/surfaces/run-control/run-record.tsx` (`engine-mismatch-dialog` and `engine-mismatch-confirm` test IDs). It explains that output will differ and resends with `accept_engine_change`.
- [X] T066 [P] [US4] Make the seed a string in the MCP `launch_run` schema (`packages/agent-tools/src/tools.ts`) and the CLI `run --seed` (`apps/cli/src/commands/run.ts`). Document the 64-bit range in `docs/agent/` sources under `packages/agent-tools/src/docs/`.

**Checkpoint**: US4 is complete. Reproducibility is guaranteed, and output changes are now versioned.

---

## Phase 6: User Story 3 - Runs and streams work reliably at reference scale (Priority: P1)

**Goal**:
- Generation is one simulated day at a time, with flat memory and refund abuse in O(1).
- Partitions run in parallel, and end-of-history world checkpoints are saved.
- Launch is atomic and partition retries work.
- Stream sessions have their own job IDs; a paused start returns 409; concurrent streams work.
- The API's event loop never stalls.

**Independent Test**: `pnpm bench:reference`, `bench:memory-flatness` and
`bench:refund-scaling` meet SC-006 to SC-008. Stop/start, two concurrent streams, a tiny run,
and a forced partition failure with retry all behave correctly (quickstart.md § US3).

### Tests for User Story 3 (write first; they must fail) ⚠️

- [X] T067 [P] [US3] Write the engine test `packages/engine/tests/property/day-simulator.test.ts`:
  - concatenated `simulateDay` outputs for days `0…D−1` are sorted by `ts`;
  - `labels[i].event_id === events[i].event_id` for every day;
  - the fraud rate is within tolerance of `fraud.target_rate` (fast-check, seeded).
- [X] T068 [P] [US3] Write the engine test `packages/engine/tests/world-checkpoint.test.ts`: `checkpointWorld` then `restoreWorld` yields byte-identical subsequent days compared with an uninterrupted world; a tampered file fails SHA-256 verification with a clear error.
- [X] T069 [P] [US3] Write the engine test `packages/engine/tests/property/refund-ring.test.ts`. Refund-abuse events always reference a prior `payment` of the same consumer, with the ring holding at most 16 purchases. Generation time for 4k consumers is at most 2.5× that for 2k, as a coarse unit guard; the real number comes from T096.
- [X] T070 [P] [US3] Write the worker test `apps/worker/tests/integration/partition-concurrency.test.ts`: with `TXLOOM_MAX_WORKER_THREADS=4` and a four-partition run, at least two partitions are `running` simultaneously, observed by polling `run_partitions`.
- [X] T071 [P] [US3] Write the worker test `apps/worker/tests/integration/run-lifecycle.test.ts`:
  - a one-consumer, one-day run reaches `completed`, never stuck in `queued`;
  - a partition that throws once and then succeeds completes, with `attempts = 2`;
  - a partition that always throws gives a `failed` run after 3 attempts, with `last_error` set;
  - the end-of-history checkpoint file exists, and `run_partitions.rng_checkpoint` holds `{path, sha256, next_day_index}`.
- [X] T072 [P] [US3] Write contract tests in `apps/api/tests/contract/test_run_retry.ts`: `POST /runs/:id/retry` is allowed only from `failed` (409 `invalid_state` otherwise), re-enqueues the partitions that aren't done with jobId suffix `-r<k>`, and the run returns to `running`.
- [X] T073 [P] [US3] Write contract tests in `apps/api/tests/contract/test_scenarios.ts`: rollback to an invalid version, a template clone whose spec is now invalid, and a launch of an invalid current version each return `400 spec_invalid` with located `details.violations[]`.
- [X] T074 [P] [US3] Write contract tests in `apps/api/tests/contract/test_stream_sessions.ts`, using a fake sink:
  - start, stop, then start gives session `seq 2`, a BullMQ job `stream-<run>-2`, and published events;
  - start while `paused` returns `409 stream_paused` with the remedy message;
  - two runs stream concurrently, and both publish their first event within 30 s of their start calls (SC-011);
  - `GET /runs/:id/stream/sessions` lists the sessions;
  - with `TXLOOM_MAX_STREAMS` sessions busy, the next start returns `409 stream_limit`.
- [X] T075 [P] [US3] Write the API test `apps/api/tests/integration/event-loop-latency.test.ts`: with `perf_hooks.monitorEventLoopDelay`, the max delay during launch, resume and stream start of a 200k-consumer spec stays under 100 ms (SC-014).
- [X] T076 [P] [US3] Write the worker test `apps/worker/tests/integration/stream-start-latency.test.ts`: stream start loads checkpoints without calling `simulateDay` for history days (spy), and the first event is published within 30 s for a 10-partition run.
- [X] T077 [P] [US3] Extend `apps/api/tests/contract/test_mcp_parity.ts`: `retry_run` is equivalent to `POST /runs/:id/retry`, including the `409 invalid_state` and `409 engine_version_mismatch` errors.

### Implementation for User Story 3

- [X] T078 [P] [US3] Add `ParquetStreamWriter` (`open(path, schema)`, `append(row)`, `close()`, with `setRowGroupSize(10_000)`) in `packages/sinks/src/file/parquet.ts`, and export it via `packages/sinks/src/index.ts`.
- [X] T079 [P] [US3] Create `packages/engine/src/world/partition-world.ts` with `PartitionWorld`, `ConsumerState` and `initPartitionWorld(spec, seed, partitionNo, partitionCount, merchants)`, as in data-model.md §2.
- [X] T080 [US3] Create the fraud planner `packages/engine/src/fraud/planner.ts`:
  - `planDay(world, dayIndex, expectedLegitCount)` draws the campaign starts per typology from the target rate and pushes `ScheduledFraudEvent`s onto the `pendingFraud` min-heap;
  - `drainDay(world, dayStart, dayEnd)` returns that day's fraud events and labels;
  - refund abuse selects from `PurchaseRing`s (research R6).

  Delete `packages/engine/src/fraud/orchestrator.ts` and update `packages/engine/src/index.ts`.
- [X] T081 [US3] Create `packages/engine/src/world/simulate-day.ts` with `simulateDay(world, dayIndex): DayOutput`. It produces income and spend with the weekend and seasonality multipliers as `truth-emit.ts` does today, records purchases into the rings, merges `drainDay` fraud, sorts by `ts`, and keeps labels aligned 1:1.
- [X] T082 [US3] Create `packages/engine/src/world/checkpoint-codec.ts` (gzip JSON plus a SHA-256 hex digest; verifying on decode). Add `checkpointWorld(world)` and `restoreWorld(spec, ckpt, merchants)` to `packages/engine/src/world/partition-world.ts`.
- [X] T083 [US3] Make `generatePartition` in `packages/engine/src/truth-emit.ts` a thin loop over `simulateDay` for days `0…clock.days−1`. Add the incremental API `accumulateDay(stats, dayOutput)` to `packages/engine/src/realism/aggregators.ts`. T080–T084 change generated output and land in one PR: in that PR, bump `ENGINE_VERSION` by one, re-baseline the golden master and add a CHANGELOG "Engine output changes" entry (per-day generation, planned fraud, refund rings).
- [X] T084 [US3] Rewrite `apps/worker/src/pool/partition-worker.ts` as a day loop:
  - `ParquetStreamWriter`s for `truth/` and `labels/`;
  - the existing per-sink delivered output, applied per day for now; US2 replaces it with the transformer;
  - incremental stats, then `checkpoints/part-<n>.v<ver>.json.gz`;
  - return `{eventsGenerated, achievedFraudRate, checkpoint: {path, sha256, next_day_index}}`.
- [X] T085 [US3] Create `apps/worker/src/pool/merchant-cache.ts`, an LRU of 8 keyed by `(runId, engineVersion)` that builds the merchant pool on first use. Remove `merchants` from every job payload and from the API:
  - `apps/api/src/services/run-launch-service.ts`;
  - `apps/api/src/routes/run-control.ts`;
  - `apps/api/src/routes/stream-control.ts`;
  - `apps/worker/src/index.ts`;
  - `apps/worker/src/jobs/generate-partition.ts`;
  - `apps/worker/src/jobs/stream-drive.ts`.
- [X] T086 [US3] Set the thread count in `apps/worker/src/pool/piscina-pool.ts` to `min(availableParallelism()−1, floor(0.6·totalmem/1GiB))`, with a minimum of 1 and an override from `TXLOOM_MAX_WORKER_THREADS`. Set the `generate-partition` Worker's `concurrency` to the pool's `maxThreads` in `apps/worker/src/jobs/generate-partition.ts` (research R4).
- [X] T087 [US3] Add partition retries: `attempts:3` and `backoff:{type:"exponential",delay:5000}` wherever partition jobs are added (`apps/api/src/services/run-launch-service.ts`, `apps/api/src/routes/run-control.ts`, `apps/worker/src/pool/resume.ts`). In `apps/worker/src/index.ts`, record the attempts, and mark the partition and run `failed` only on the final attempt or an `UnrecoverableError`. Store the checkpoint ref on done.
- [X] T088 [US3] Make launch atomic in `apps/api/src/services/run-launch-service.ts`: one Knex transaction inserts the run as `running` with `started_at`, its partitions and its destinations, and jobs are enqueued after commit. If enqueueing fails, set the run to `failed` with the error (research R13).
- [X] T089 [US3] Add `POST /runs/:id/retry` to `apps/api/src/routes/run-control.ts`, with the engine-version guard and jobId suffix `-r<k>`, where k is the stored retry count.
- [X] T090 [P] [US3] Add the MCP tool `retry_run` (`packages/agent-tools/src/tools.ts`, registered in `apps/api/src/mcp/tools/run-tools.ts`) and the CLI command `run-retry` (`apps/cli/src/commands/run-control.ts`, registered in `apps/cli/src/registry.ts`), both mapping onto `POST /runs/:id/retry`.
- [X] T091 [US3] Re-validate the spec with `validateSpec` from `@txloom/spec` at rollback (`apps/api/src/routes/spec-versions.ts`), template clone (`apps/api/src/routes/scenarios.ts`) and launch (`apps/api/src/routes/runs-launch.ts`), returning `400 spec_invalid`.
- [X] T092 [US3] Implement migration `apps/api/src/db/migrations/013_stream_sessions.ts`: `streams.state` gains `error`; `streams` gains the `destinations` JSON column, backfilled from `run_destinations`; and the `stream_sessions` table (data-model.md §1.7). Add the repository `apps/api/src/db/repositories/stream-sessions.ts`, and extend `apps/api/src/db/repositories/streams.ts` with the `error` state and `destinations` (initialized from `run_destinations` when the stream row is created).
- [X] T093 [US3] Rewrite the stream lifecycle in `apps/api/src/routes/stream-control.ts`:
  - start from `idle` or `stopped` creates session `seq+1` with jobId `stream-<runId>-<seq>`, plus `removeOnComplete:{age:86400}` and `removeOnFail:{age:604800}`;
  - start while paused returns `409 stream_paused`;
  - `409 stream_limit` counts active sessions against `TXLOOM_MAX_STREAMS`, default 4;
  - stop is allowed from `error`;
  - stream start now reads `streams.destinations` (replacing the direct `run_destinations` read from T042) and copies it into the session's `destinations_snapshot`;
  - add `GET /runs/:id/stream/sessions`.
- [X] T094 [US3] In `apps/worker/src/jobs/stream-drive.ts`:
  - set the Worker's `concurrency` to `TXLOOM_MAX_STREAMS`, with `maxStalledCount: 10` and `stalledInterval: 15000`, so that a worker restart hands stalled sessions back instead of failing them (research R7);
  - replace `resumeLiveWorld`'s history regeneration with loading the checkpoint files through `restoreWorld` (`packages/engine/src/streaming/live-world.ts`);
  - mark the session ended on job exit.
- [X] T095 [US3] Add boot reconciliation in `apps/worker/src/index.ts`: a stream in `streaming` or `paused` whose current-session job is **missing from BullMQ** (not merely stalled) moves to `stopped`, with `last_error` "session job lost; start the stream again". Stalled jobs are left for BullMQ to re-run, and T154 resumes them in the same session (contracts/api.md invariant 4).
- [X] T096 [P] [US3] Create the benchmarks `benchmarks/batch/bench-reference.ts` (the reference spec through the API, recording wall time, peak RSS per thread and events/s to `benchmarks/results/<date>.json`), `benchmarks/batch/bench-memory-flatness.ts` (30 vs 90 days, fail if growth exceeds 10%) and `benchmarks/batch/bench-refund-scaling.ts` (2k vs 4k, fail if the ratio exceeds 2.5×). `bench-reference.ts` exits non-zero if the wall time is 30 min or more (SC-006), or if any generating thread's peak RSS is 1 GB or more (SC-007). Put the shared harness in `benchmarks/batch/lib.ts`.
- [X] T097 [US3] Create the CI smoke variant `benchmarks/batch/bench-smoke.ts` (20k consumers × 14 days) with its baseline `benchmarks/batch/baseline-smoke.json`, failing above a 15% regression. Add a `batch-smoke` job to `.github/workflows/ci.yml` beside `bench-smoke`.
- [X] T098 [P] [US3] In the run UI (`apps/web/src/surfaces/run-control/run-detail.tsx`), show the partition attempts, `last_error` and a Retry button (`run-retry`) for failed runs. In `apps/web/src/surfaces/stream-console/stream-console.tsx`, show the `stream_paused` and `stream_limit` messages.

**Checkpoint**: US3 is complete. Reference-scale budgets are met, and stream and run lifecycles behave correctly.

---

## Phase 7: User Story 2 - Delivered data matches the answer key (Priority: P1)

**Goal**:
- Every sink's output is its delivered copy with real, labeled imperfections, from a per-event transformer.
- Failed deliveries are labeled `dropped`.
- Sink plugin v2 counts only acknowledged messages as delivered.
- History replay to brokers is available when the option is on.

**Independent Test**: The `@answer-key` e2e story reconciles every sink's delivered output
against its answer key (SC-004; quickstart.md § US2).

### Tests for User Story 2 (write first; they must fail) ⚠️

- [X] T099 [P] [US2] Rewrite `packages/engine/tests/property/imperfections.test.ts` for `ImperfectionTransformer`:
  - every corruption label has a matching delivered record in the same sink;
  - late records are emitted in `delivered_at` order, after records with earlier `delivered_at`, and keep their original `ts`;
  - skewed records have `ts = truth ts + offset` exactly;
  - duplicates share `event_id` but have distinct `delivery_id`s;
  - an imperfection targeting sink A leaves sink B clean;
  - each rate is within tolerance;
  - truth events are never mutated.
- [X] T100 [P] [US2] Write the engine test `packages/engine/tests/transformer-state.test.ts`: transformer state checkpointed mid-stream restores to identical output; `flush()` emits every pending late event; adding a second sink doesn't change the first sink's delivered output or the truth.
- [X] T101 [P] [US2] Write the pump unit test `packages/sinks/tests/pump.test.ts`, using a fake Sink v2 with scripted latency and failures:
  - in-flight never exceeds `maxInFlight`;
  - delivered counts only resolved `ok`;
  - retryable failures re-attempt with backoff from the heap;
  - after `max_attempts`, or a non-retryable error, exactly one label with `delivery_outcome: "dropped"` and `corruption_type: null` is emitted, with `{error, attempts}`.
- [X] T102 [P] [US2] Update `packages/sinks/tests/integration/webhook-retry.test.ts` for Sink v2: `publish` never retries internally; a hanging server resolves `{ok:false, retryable:true}` after `timeout_ms`; a 400 is not retryable; 429 and 503 are retryable.
- [X] T103 [P] [US2] Write the integration test `packages/sinks/tests/integration/rabbitmq-confirms.test.ts`: `publish` resolves `ok` only after the broker confirms, which is observed by delaying confirms through a blocked connection, and a nack resolves `ok:false`.
- [X] T104 [P] [US2] Write the integration test `packages/sinks/tests/integration/kafka-ack.test.ts`: `publish` resolves after the delivery report, and 1,000 concurrent publishes within `maxInFlight` all land on the topic.
- [X] T105 [P] [US2] Write contract tests in `apps/api/tests/contract/test_exports.ts` (research R19):
  - `POST /runs/:id/exports` returns `202` with `status:"queued"`, and polling `GET …/exports/:id` reaches `completed` (or `failed` with `error` for an unknown sink source);
  - `source:{kind:"sink",name:"archive"}` exports `delivered/archive`;
  - the default source is the first file sink, else truth;
  - the answer key for a sink source includes `corruptions/<sink>` and the `delivery_outcome: dropped` rows;
  - the truth source's answer key is `labels/` only.
- [X] T106 [P] [US2] Write contract tests in `apps/api/tests/contract/test_deliveries.ts`:
  - `replay_history:true` creates one `run_deliveries` row per bound sink;
  - `POST /runs/:id/deliveries/:sink/retry` continues from the cursor;
  - `.../skip` moves to `skipped`;
  - `stream/start` returns `409 replay_pending` while a delivery is pending, running or failed.
- [X] T107 [P] [US2] Write the worker test `apps/worker/tests/integration/deliver-replay.test.ts`:
  - a replay to a Testcontainers Kafka publishes every `delivered/events` row in delivery order, with `delivered_at` present;
  - a replay to a webhook that returns 500 writes `deliveries/<sink>/dropped-0.parquet` with one row per event, and the run delivery ends `failed` with counts.
- [X] T108 [P] [US2] Write the e2e story `apps/e2e/tests/05-answer-key.spec.ts` (`@answer-key`), using `apps/e2e/fixtures/imperfections-all.json` with `replay_history:true`:
  - reconcile the Parquet files of the file sink, through `apps/e2e/src/parquet-reader-cli.ts`, and the Kafka topic, through `apps/e2e/src/kafka-consumer.ts`, against the answer key;
  - assert zero orphan records and zero missing delivered records.
- [X] T109 [P] [US2] Update `analytics-flink/jobs/java/src/test/java/dev/txloom/flink/CleanAndOrderJobTest.java` so it orders and deduplicates by `delivered_at`, and expects a late event to keep its original `ts`.
- [X] T110 [P] [US2] Extend the component test `apps/web/tests/export-controls.test.tsx` against the mock adapter (constitution III, export surface): the source select lists Truth plus each file sink and defaults to the first file sink; the label-inclusion warning and its acknowledgement still gate `include_labels`; the queued and running status shows while the export job runs; the download link appears only once it is `completed`.
- [X] T111 [P] [US2] Extend `apps/api/tests/contract/test_mcp_parity.ts`: `create_export` returns `queued` like the REST call, and `get_export` polls to the same `completed` manifest. Extend `apps/api/tests/integration/event-loop-latency.test.ts` (T075): while a 2M-event export is built, the API's maximum event-loop delay stays under 100 ms.
- [X] T112 [P] [US2] Extend `apps/api/tests/contract/test_ws_progress.ts`: `run-progress` carries `phase` (`generating`, `replaying`, `live`, `done`) and `deliveries[]` with `{sink, state, published, failed, total}`.

### Implementation for User Story 2

- [X] T113 [US2] Extend the engine types in `packages/engine/src/types.ts`:
  - `CorruptionType` stays exactly the four injectable imperfections;
  - `LabelRecord` gains `delivery_outcome: "dropped" | null` (data-model.md §2), with a matching optional `delivery_outcome` column in `LABEL_RECORD_SCHEMA` in `packages/sinks/src/file/parquet.ts`;
  - add `WirePayload`, which is the truth payload plus `delivery_id`, `delivered_at` and `sent_at`;
  - add `Delivered`, as in data-model.md §2;
  - remove `DeliveredEvent` and `PartitionOutput`.
- [X] T114 [US2] Create `packages/engine/src/imperfections/transformer.ts`:
  - `ImperfectionTransformer` (`push`, `drainUntil`, `flush`, `checkpoint`, `restore`), seeded with `deriveNamedRng(seed, "imperfections:<sink>:p<n>")`;
  - a late min-heap, a skew offset, an out-of-order hold slot, and duplicates emitted immediately after their primary (research R9).
  - T114–T115 change generated output and land in one PR: bump `ENGINE_VERSION` by one, re-baseline the golden master and add a CHANGELOG "Engine output changes" entry (transformer, late-arrival semantics).

  Delete `packages/engine/src/imperfections/pipeline.ts` and update `packages/engine/src/index.ts`.
- [X] T115 [US2] Change `apps/worker/src/pool/partition-worker.ts` to run one transformer per output sink per day:
  - `drainUntil(dayEnd)` writes `delivered/<sink>/part-<n>.parquet` and the aligned `delivered/<sink>/labels-part-<n>.parquet`;
  - corruptions go to `corruptions/<sink>/part-<n>.parquet`;
  - `flush()` runs after the last day;
  - add the `delivered_at` column to the delivered Parquet schema in `packages/sinks/src/file/parquet.ts`.
- [X] T116 [US2] Move the readers to the new layout (data-model.md §3): `apps/api/src/services/truth-store.ts`, `apps/api/src/services/inspector/imperfection-audit.ts` and `apps/api/src/routes/truth-events.ts`. Labels come from `labels/`, and corruptions from `corruptions/<sink>/` plus `deliveries/<sink>/dropped-*`.
- [X] T117 [US2] Move export building into a worker job (research R19); the tests in T105, T110 and T111 must fail first:
  - add the `exportBuild` queue to `apps/api/src/services/queues.ts`;
  - create `apps/worker/src/jobs/export-build.ts` with the logic from `apps/api/src/services/export-service.ts`: `source` selection (truth or a file sink, with the default rule), and an answer key that includes corruptions and `delivery_outcome: dropped` rows for sink sources; the manifest moves `queued → running → completed | failed`;
  - `apps/api/src/routes/exports.ts` validates the request (including the label-warning acknowledgement), writes the `queued` manifest, enqueues the job, returns `202`, and serves the status;
  - reduce `apps/api/src/services/export-service.ts` to request validation and manifest reads;
  - update the MCP `create_export` and `get_export` handlers in `apps/api/src/mcp/tools/export-tools.ts` and their descriptions in `packages/agent-tools/src/tools.ts`;
  - in `apps/web/src/surfaces/ground-truth/export-controls.tsx`, add the source select and poll the status until `completed`;
  - make the CLI `export` command (`apps/cli/src/commands/export.ts`) poll `GET /runs/:id/exports/:exportId` until `completed` or `failed`, accept a `--source truth|<sink>` flag, and exit non-zero with the job's `error` on failure;
  - add a CHANGELOG "API removals" entry: exports are asynchronous (`202` plus a status to poll).
- [X] T118 [US2] Implement the Sink v2 interface in `packages/sinks/src/interface.ts`: `SINK_PLUGIN_API_VERSION=2`, plus `publish(target, body, envelope, signal)` with acknowledgement semantics, `maxInFlight`, `saturated?` and `waitForCapacity?` (contracts/sink-plugin.md).
- [X] T119 [P] [US2] Kafka v2 in `packages/sinks/src/kafka/producer.ts`: `publish` resolves on the `send()` delivery report, with `linger.ms=5` and `batch.num.messages=10000`. Carry the headers `txloom-run-id`, `txloom-session-seq` and `txloom-engine-version`, and set `maxInFlight=1000`.
- [X] T120 [P] [US2] RabbitMQ v2 in `packages/sinks/src/rabbitmq/publisher.ts`: resolve from the confirm-channel publish callback, map a nack to `ok:false, retryable:true`, set `saturated` when `publish()` returns false with `waitForCapacity` on `'drain'`, and set `maxInFlight=256`.
- [X] T121 [P] [US2] Webhook v2 in `packages/sinks/src/webhook/publisher.ts`: remove the internal retry loop, use `AbortSignal.any([signal, AbortSignal.timeout(timeout_ms)])`, classify 408, 429, 5xx and network errors as retryable and other 4xx as not, and set `maxInFlight=32`.
- [X] T122 [US2] Create `packages/sinks/src/wire.ts` with `encodeWirePayload(payload): Uint8Array` and the partition-key extraction (contracts/wire-format.md).
- [X] T123 [US2] Create `packages/sinks/src/pump.ts`, the `DeliveryPump` (contracts/sink-plugin.md items 1–3 and 6):
  - an in-flight window and a retry min-heap with jittered backoff;
  - `onDropped(label)` and `onDelivered()` callbacks;
  - a `metrics()` snapshot;
  - unpaced mode for replay;
  - a pacing hook interface, implemented in US7.

  Export it from `packages/sinks/src/index.ts`.
- [X] T124 [US2] Implement migration `apps/api/src/db/migrations/014_run_deliveries.ts` and the repository `apps/api/src/db/repositories/run-deliveries.ts` (data-model.md §1.6).
- [X] T125 [US2] Create the `deliver` job `apps/worker/src/jobs/deliver.ts`:
  - stream `delivered/<sink>/part-*.parquet` in partition and row order, starting from the cursor;
  - publish through the pump to the destination's connection, resolved as in T043;
  - checkpoint the cursor and counts every 10k rows;
  - write the dropped labels with a `ParquetStreamWriter` to `deliveries/<sink>/dropped-<k>.parquet`;
  - write the `destination_snapshot` when the delivery starts;
  - end in `done` or `failed`.

  Add a `deliver` queue to `apps/api/src/services/queues.ts`.
- [X] T126 [US2] In `apps/worker/src/index.ts`, when generation completes and `run.replay_history` is set, create the `run_deliveries` rows and enqueue one `deliver` job per bound non-file sink.
- [X] T127 [US2] Add `replay_history` to `LaunchRequest` in `apps/api/src/routes/runs-launch.ts`; persist it to `runs.replay_history`. Add `POST /runs/:id/deliveries/:sink/retry|skip` in `apps/api/src/routes/run-control.ts`, and `409 replay_pending` on stream start in `apps/api/src/routes/stream-control.ts`.
- [X] T128 [US2] Add `phase` (`generating`, `replaying`, `live`, `done`) and `deliveries[]` to the `run-progress` WebSocket payload in `apps/api/src/ws/run-progress.ts`, derived from `runs.status`, `run_deliveries` and the stream state.
- [X] T129 [US2] Switch `apps/worker/src/jobs/stream-drive.ts` from serial `sink.publish` to the `DeliveryPump`. Failed live deliveries emit `dropped` labels to `deliveries/<sink>/dropped-*.parquet` and to the label channel, and the metrics report `failed_total`.
- [X] T130 [P] [US2] Add `replay_history` to MCP `launch_run` in `packages/agent-tools/src/tools.ts`, and `--replay-history` to the CLI in `apps/cli/src/commands/run.ts`.
- [X] T131 [P] [US2] Update `analytics-flink/jobs/java/src/main/java/dev/txloom/flink/common/Event.java` (add `delivered_at` using `EpochMillisJson`), `analytics-flink/jobs/java/src/main/java/dev/txloom/flink/CleanAndOrderJob.java` (order by `delivered_at`) and `analytics-flink/README.md` (the `ts` semantics).
- [X] T132 [US2] Add CHANGELOG entries in `CHANGELOG.md`: "Wire format", covering `ts` semantics, `delivered_at` and `sent_at`; "Sink plugin API v2"; and confirm the "Engine output changes" entry from T114 covers the transformer and late-arrival semantics. Update the plugin authoring guide `docs/extending.md` to Sink v2, with a migration section.

**Checkpoint**: US2 is complete. The answer key is honest for files, brokers and webhooks.

---

## Phase 8: User Story 5 - Launch from the scenario page in one place (Priority: P2)

**Goal**:
- A Launch drawer on the scenario page with destinations, mode, rate, Advanced options and an estimate.
- Remembered destinations, and inline connection creation.
- Live auto-starts for `history_then_live` runs.

**Independent Test**: From a cloned template, launch a history-then-live run to Kafka from the
scenario page. Live starts automatically after history, with no other section visited
(quickstart.md § US5).

**Depends on**: US1 (destinations). US2 is needed only for the replay parts: T137's replay cases, T138, T142 and T144 (which use US2's `phase` and `deliveries[]` from T128).

### Tests for User Story 5 (write first; they must fail) ⚠️

- [ ] T133 [P] [US5] Write the engine test `packages/engine/tests/estimate.test.ts`: `estimateRun` is within ±10% of the actual generated event count for the three e2e fixtures and the reference fixture at 1% scale, `replay_messages` accounts for the duplicate rate, and it completes in under 5 ms.
- [ ] T134 [P] [US5] Write contract tests in `apps/api/tests/contract/test_estimate.ts`: `POST /spec/estimate` is side-effect-free and returns the `RunEstimate` shape, an invalid spec returns `400 spec_invalid`, and `replay_history:true` makes `replay_messages` greater than 0.
- [ ] T135 [P] [US5] Write contract tests in `apps/api/tests/contract/test_launch.ts`:
  - the mode defaults to `history_then_live` when any broker destination exists, else `history_only`;
  - `target_tps` defaults to `spec.clock.then_stream_tps ?? 50`;
  - `launch-defaults` drops sinks renamed out of the current spec;
  - mode, rate, replay and label channel from the last launch are prefilled from `scenario_launch_defaults`;
  - a launch with `replay_history:true` to a topic whose stored `retention_ms` is shorter than the history window returns `201` with a `retention_shorter_than_history` warning.
- [ ] T136 [P] [US5] Write the worker test `apps/worker/tests/integration/auto-live.test.ts`: a `history_then_live` run auto-creates stream session 1 with the run's destinations and `target_tps` once generation completes; with `replay_history`, only after every delivery is `done` or `skipped`; with a failed delivery, no session starts.
- [ ] T137 [P] [US5] Write the component test `apps/web/tests/launch-drawer.test.tsx` against the mock adapter:
  - a row per spec sink;
  - choosing a Kafka destination preselects history-then-live;
  - an unbound broker sink blocks launch with `launch-error`, naming the sink;
  - "New connection…" then save selects the new connection and keeps every other field;
  - prefill from launch defaults;
  - turning on replay updates `launch-estimate`;
  - with replay on and a destination whose last test reported a retention shorter than the history window, `launch-warning-retention` appears and Launch stays enabled.
- [ ] T138 [P] [US5] Write the component test `apps/web/tests/run-detail-replay.test.tsx` against the mock adapter: when `phase` is `replaying`, `run-detail.tsx` shows one `delivery-row-<sink>` per destination with its progress; a failed row shows `delivery-retry-<sink>` and `delivery-skip-<sink>`, which call the deliveries retry and skip endpoints.

### Implementation for User Story 5

- [ ] T139 [US5] Create `packages/engine/src/estimate.ts` with `estimateRun(spec, {replayHistory, throughputPerThread, threads})` (research R16), and export it from `packages/engine/src/index.ts`.
- [ ] T140 [US5] Add `POST /spec/estimate` in `apps/api/src/routes/spec.ts`, reading the `settings.generation_throughput` key (default 150,000 events/s per thread). In `apps/worker/src/index.ts`, update that setting from each completed run's measured events/s per thread.
- [ ] T141 [US5] Finish `LaunchRequest` in `apps/api/src/routes/runs-launch.ts`: mode, `target_tps` and `label_channel` with their defaults. Upsert `scenario_launch_defaults` (mode, rate, replay, label channel) through `apps/api/src/db/repositories/launch-defaults.ts`, and serve them from `launch-defaults`. When `replay_history` is on, compare the history window with each Kafka destination's stored `retention_ms` and add the non-blocking `retention_shorter_than_history` warning to the response.
- [ ] T142 [US5] Add the live auto-start in `apps/worker/src/index.ts`. Once generation is complete and every delivery is `done` or `skipped` (re-checked on each delivery transition), create the stream and session 1 and enqueue `stream-drive` with the run's destinations and `target_tps`. Reuse the session-creation code from `apps/api/src/routes/stream-control.ts`, extracted into `apps/api/src/services/stream-sessions.ts`.
- [ ] T143 [US5] Wire the Launch drawer (T015) to the real client: `launch-defaults`, the debounced estimate, the launch call and navigation to `/runs/:id/progress`. Show `launch-warning-retention` from the API's warnings or the destination's last test result. Open it from the Launch button and `?launch=1` in `apps/web/src/surfaces/scenario-workspace/index.tsx`. Delete `apps/web/src/surfaces/run-control/run-launch.tsx` and its route, redirecting `/runs/new?scenario=:id` to `/scenarios/:id?launch=1`.
- [ ] T144 [US5] Add the replay phase to `apps/web/src/surfaces/run-control/run-detail.tsx`, using the `phase` and `deliveries[]` from T128: a `delivery-row-<sink>` per destination with its progress, plus retry and skip buttons for failed rows. US8's run page later hosts this view in its Progress tab.
- [ ] T145 [P] [US5] Add the MCP tool `estimate_run` in `packages/agent-tools/src/tools.ts` and `apps/api/src/mcp/tools/read-tools.ts`, plus its parity case in `apps/api/tests/contract/test_mcp_parity.ts`.
- [ ] T146 [US5] Rewrite `apps/e2e/tests/01-golden-path.spec.ts` and `apps/e2e/src/ui.ts` to launch through the drawer: `launch-open`, `launch-destination-<sink>`, `launch-submit`.

**Checkpoint**: US5 is complete. Launching takes one panel, and relaunching takes one click.

---

## Phase 9: User Story 6 - The live stream is the same world, continued (Priority: P2)

**Goal**: Live mode runs the same `simulateDay` from the restored checkpoint on days `D, D+1, …`,
k-way merged across partitions in a dedicated thread. It is paced by TPS, stamped with
simulated time, carries fraud and imperfections, and its labels go to the label channel.

**Independent Test**: The live timestamps continue from the end of history. The live mix
includes income credits and labeled fraud, and the weekday/weekend ratio matches history
within 10% (quickstart.md § US6, SC-012).

**Depends on**: US3 (simulator and checkpoints) and US2 (transformer and pump).

### Tests for User Story 6 (write first; they must fail) ⚠️

- [ ] T147 [P] [US6] Write the golden master `packages/engine/tests/golden-master/history-live-equivalence.test.ts`: history days `0…D−1`, then `checkpointWorld`, then `restoreWorld`, then live days `D…D+k`, must be byte-identical to an uninterrupted `D+k` simulation, for truth, labels and per-sink delivered output.
- [ ] T148 [P] [US6] Rewrite `packages/engine/tests/property/continuity.test.ts`:
  - the first live `ts` is at or after the end of the history window, with no gap beyond normal inter-arrival;
  - `income_credit` events appear;
  - fraud labels appear across a horizon covering typical campaign spacing;
  - the weekday/weekend volume ratio is within 10% of history.
- [ ] T149 [P] [US6] Write the worker test `apps/worker/tests/integration/live-world-thread.test.ts`:
  - the thread emits batches in ascending `delivered_at` merged across partitions;
  - its buffer never exceeds its cap;
  - pause, resume and a rate change keep simulated time and world state continuous;
  - after a simulated crash, a session resumed from the latest day checkpoint skips exactly `delivered_since_checkpoint` deliveries and reuses `delivery_id`s;
  - killing the worker process mid-stream and starting a new one resumes the *same* session (`seq` unchanged) through BullMQ's stalled-job check, with no imperfection labels added for repeated deliveries.
- [ ] T150 [P] [US6] Update `apps/worker/tests/integration/kafka-stream.test.ts`: the message `ts` is simulated time, `sent_at` is wall-clock, and with `label_topic` set the label topic receives labels with fraud and corruption types.

### Implementation for User Story 6

- [ ] T151 [US6] Rewrite `packages/engine/src/streaming/live-world.ts`:
  - `openLiveWorld(spec, seed, checkpoints, merchants, sinks)` restores every partition's world plus a fresh transformer per sink and partition;
  - `nextBatch(maxEvents)` simulates days on demand and k-way merges the partitions by `delivered_at`;
  - `checkpoint()` returns per-partition checkpoints including transformer state.
  - This changes live-stream content for existing seeds and specs: bump `ENGINE_VERSION` by one in this PR, re-baseline the golden master and add a CHANGELOG "Engine output changes" entry.

  Delete `drawNextLiveEvent`, `liveEventLabel` and `resumeLiveWorld`.
- [ ] T152 [US6] Create the live-world thread `apps/worker/src/live/live-world-thread.ts`, with its `.mjs` entry modelled on `apps/worker/src/pool/worker-entry.mjs`:
  - it holds the `openLiveWorld` state;
  - it serves a `MessagePort` request/response protocol (`more(n)`, `checkpoint()`, `close()`) with a low-water refill, buffering by default 2 simulated hours or 50k events (research R5).
- [ ] T153 [US6] Rewrite the live loop in `apps/worker/src/jobs/stream-drive.ts`:
  - spawn the thread per session;
  - pace the pump by tokens at the target TPS;
  - set `sent_at` at publish;
  - track `sim_time` from the last emitted `delivered_at`;
  - write the label channel to `label_topic` or `label_routing_key` through a second sink target, mirrored to `stream-labels.jsonl` (`apps/worker/src/jobs/stream-label-channel.ts`).
- [ ] T154 [US6] Add live checkpoints in `apps/worker/src/jobs/stream-drive.ts`:
  - at each simulated-day boundary, write `streams/<sessionId>/part-<n>.day-<d>.json.gz`, keeping the last 2;
  - persist `delivered_since_checkpoint` and the counters to `stream_sessions` once a second;
  - on stop, take a final checkpoint;
  - a new session's `resume_from` is the previous session's final checkpoint, else the history end;
  - crash resume skips the first `delivered_since_checkpoint` deliveries.
- [ ] T155 [P] [US6] Show the simulated clock (`sim_time`) and session number in the live tab in `apps/web/src/surfaces/stream-console/stream-console.tsx`.

**Checkpoint**: US6 is complete. Live mode is literally history continued.

---

## Phase 10: User Story 7 - Honest stream health under load and failure (Priority: P2)

**Goal**:
- AIMD backpressure into the rate limiter, and real sink lag.
- A breaker that moves the stream to `error`.
- RabbitMQ drain handling, and webhooks that can't stall the stream.
- The Kafka benchmark at 1,000 TPS through real sessions.

**Independent Test**: Throttled Kafka, a hanging webhook and blocked RabbitMQ each make the
lag and backpressure indicators respond. The achieved rate adapts, no undelivered event counts
as delivered, and SC-010 is met (quickstart.md § US7).

**Depends on**: US2 (pump) and US6 (live loop).

### Tests for User Story 7 (write first; they must fail) ⚠️

- [ ] T156 [P] [US7] Write the unit test `packages/sinks/tests/pump-pacing.test.ts`, with fake timers and a fake sink:
  - `aimd_rate` halves on backpressure, with a floor of 1;
  - it recovers by 5% of the target per second;
  - `sink_lag = in_flight + retry_queue + due backlog`;
  - the breaker trips when more than 50% failed over 30 s with at least 100 completions, and not below 100.
- [ ] T157 [P] [US7] Write the integration test `packages/sinks/tests/integration/kafka-throttled.test.ts`: against a Testcontainers broker with a client quota (`producer_byte_rate`), backpressure becomes true, `aimd_rate` falls below the target, and memory stays bounded.
- [ ] T158 [P] [US7] Update `packages/sinks/tests/integration/rabbitmq-backpressure.test.ts`: a blocked connection (memory alarm) sets `saturated`, the pump waits on `waitForCapacity`, and nothing counts as delivered until confirmed.
- [ ] T159 [P] [US7] Write the integration test `packages/sinks/tests/integration/webhook-hang.test.ts`: with one hanging endpoint and a target of 200 TPS, the achieved rate never drops to 0 over 20 s, and exhausted retries become `dropped`.
- [ ] T160 [P] [US7] Extend `apps/api/tests/contract/test_stream.ts`: `GET /runs/:id/stream` returns every `StreamMetrics` field, the `error` state is reported with `last_error`, stop from `error` gives `stopped`, and start from `stopped` after an error gives a new session.

### Implementation for User Story 7

- [ ] T161 [US7] Implement pacing in `packages/sinks/src/pump.ts` using `packages/engine/src/streaming/token-bucket.ts`:
  - the effective rate is `min(target, aimd)`;
  - AIMD halves on backpressure (window full or `saturated`) and adds `0.05·target` per second otherwise;
  - the breaker uses a rolling 30 s window;
  - metrics include `aimd_rate`, `sink_lag`, `in_flight`, `retry_queue` and `backpressure`.
- [ ] T162 [US7] Wire the breaker and metrics in `apps/worker/src/jobs/stream-drive.ts`: on trip, set the stream to `error` and the session's `last_error`, stop publishing, and hold the session until stop. Write the full `StreamMetrics` once a second through `apps/api/src/db/repositories/streams.ts`.
- [ ] T163 [P] [US7] Show the lag, backpressure, AIMD-versus-target rate, failed count and the error banner (`stream-lag`, `stream-backpressure`, `stream-error`) in `apps/web/src/surfaces/stream-console/stream-console.tsx`, and add the `error` state to `apps/web/src/surfaces/stream-console/stream-state.ts`.
- [ ] T164 [US7] Rewrite the Kafka benchmark `benchmarks/kafka/bench.ts` and `benchmarks/kafka/lib.ts` to launch the reference spec with all typologies and imperfections through the API, start a real stream session at 1,000 TPS for 30 minutes, and assert that at least 99% of 1-second windows are within ±5% with flat RSS (SC-010). Update `benchmarks/kafka/bench-smoke.ts` and `benchmarks/kafka/baseline-smoke.json` to the session-based path.

**Checkpoint**: US7 is complete. Stream indicators reflect reality.

---

## Phase 11: User Story 8 - One run page, clear navigation, and a two-click first run (Priority: P3)

**Goal**:
- Navigation becomes Scenarios · Runs · Connections, and each run has one page with tabs.
- Runs are named by scenario and version; old routes redirect; router links are used everywhere.
- `local-kafka` is seeded automatically, and the first-run card works.

**Independent Test**: On a fresh install with the demo broker, two clicks put events on a
topic. Every tab of a run is reachable without picking the run again (quickstart.md § US8,
SC-001).

**Depends on**: US1 (connections) and US5 (launch). It uses US7's metrics on the Live tab if
they are present.

### Tests for User Story 8 (write first; they must fail) ⚠️

- [ ] T165 [P] [US8] Write the API test `apps/api/tests/integration/local-kafka.test.ts`:
  - booting with a reachable fake broker on `kafka:29092` (DNS override) seeds `local-kafka` with `managed_by:"auto"` once;
  - after it is deleted, a reboot doesn't re-seed;
  - `GET /connections/suggestions` returns the local broker when it's unregistered;
  - `TXLOOM_CONNECTIONS_JSON` upserts by name with `managed_by:"env"`, and PATCH returns 403.
- [ ] T166 [P] [US8] Extend `apps/api/tests/contract/test_connections.ts` for `GET /connections/suggestions` (constitution III): the response shape, a `local_kafka` suggestion when the probe succeeds and no connection points at it, and an empty list once one does.
- [ ] T167 [P] [US8] Extend `apps/api/tests/contract/test_destinations.ts`: `PUT /runs/:id/stream/destinations` returns `409 stream_active` while a session is `streaming`, `paused` or `error`, and succeeds when stopped; afterwards `GET /runs/:id` still returns the original `launch_destinations[]`, and the next session's `destinations_snapshot` holds the new destination.
- [ ] T168 [P] [US8] Extend `apps/api/tests/contract/test_runs.ts`: `GET /runs` items include `scenario.name` and `spec_version.number`.
- [ ] T169 [P] [US8] Write the component test `apps/web/tests/run-page.test.tsx` against the mock adapter:
  - all five tabs render run-scoped content with no run picker;
  - Progress switches to Live automatically when `phase:"live"` arrives, unless the user switched tabs manually;
  - the destination chip is read-only, and `live-destination-change` is disabled unless the stream is stopped.
- [ ] T170 [P] [US8] Write the component tests `apps/web/tests/routes-redirect.test.tsx`, which checks every redirect in contracts/ui-routes.md, and `apps/web/tests/first-run.test.tsx`, where the card appears only with zero scenarios and the start button calls create from template, then launch with the `local-kafka` destination.
- [ ] T171 [P] [US8] Write the e2e story `apps/e2e/tests/06-first-run.spec.ts` (`@first-run`): on a fresh stack with `demo-brokers`, click `first-run-start`, then confirm events on `txloom.events` through `apps/e2e/src/kafka-consumer.ts`, and that the page lands on `run-tab-live`.

### Implementation for User Story 8

- [ ] T172 [US8] Create `apps/api/src/services/local-kafka.ts`:
  - `probeLocalKafka()`: DNS lookup of `kafka` plus a TCP connect to 29092, with a 1 s timeout;
  - `seedOnBoot()`, guarded by the `settings.local_kafka_seeded` key;
  - `suggestions()`;
  - `applyEnvConnections()` from `TXLOOM_CONNECTIONS_JSON`.

  Call the boot functions from `apps/api/src/server.ts`, and add `GET /connections/suggestions` to `apps/api/src/routes/connections.ts`.
- [ ] T173 [US8] Add `PUT /runs/:id/stream/destinations` to `apps/api/src/routes/stream-control.ts`, reusing `validateDestinations` (T040) and the `stream_active` guard. It updates only `streams.destinations`; `run_destinations` is never written after launch.
- [ ] T174 [US8] Add `scenario {id, name}` and `spec_version {id, number}` to the run list and detail in `apps/api/src/routes/runs-read.ts`, and expose `launch_destinations[]` there.
- [ ] T175 [US8] Wire the run page (T016) in `apps/web/src/surfaces/run/index.tsx`:
  - Progress hosts `apps/web/src/surfaces/run-control/run-detail.tsx`, including the replay rows from T144;
  - Live hosts `stream-console.tsx`;
  - Inspect hosts `apps/web/src/surfaces/world-inspector/index.tsx`;
  - Ground truth hosts `apps/web/src/surfaces/ground-truth/index.tsx`;
  - Export hosts `export-controls.tsx`.

  Remove the run pickers from those surfaces, pass `runId` as a prop, and keep the compare picker in Inspect for the *other* run only.
- [ ] T176 [US8] Finalize the routes and navigation in `apps/web/src/components/layout/app-shell.tsx` and `apps/web/src/components/layout/nav-items.ts`: the `/runs/:id/:tab` routes, `/` showing the first-run card or redirecting, and the `<Navigate>` redirects for `/stream*`, `/inspector*`, `/ground-truth*` and `/settings/sinks`.
- [ ] T177 [US8] Show run titles as "Scenario · v<n> · start time", with the ID secondary, in `apps/web/src/surfaces/run-control/run-list.tsx` and the run page header (`run-title`).
- [ ] T178 [P] [US8] Wire the first-run card (T017) in `apps/web/src/surfaces/home/first-run.tsx` to clone the UPI template, set `local-kafka` as its destination, and launch `history_then_live`. Show the `local-kafka-suggestion` prompt on the Connections page and in the Launch drawer's destination list when the local broker is detected.
- [ ] T179 [P] [US8] Show the `version-saved-badge` after a template clone in `apps/web/src/surfaces/scenario-workspace/index.tsx`, using `current_version.number` from the clone response (`apps/api/src/routes/scenarios.ts`).
- [ ] T180 [US8] Replace every in-app `<a href>` with a router `<Link>` (`apps/web/src/surfaces/run-control/run-list.tsx` and every remaining occurrence under `apps/web/src`). Add a `no-restricted-syntax` rule for JSX `a` elements whose `href` starts with "/" in `eslint.config.js`.
- [ ] T181 [US8] Update the remaining e2e flows to the new routes and test IDs: `apps/e2e/src/ui.ts`, `apps/e2e/tests/03-mcp-parity.spec.ts` (UI side) and `apps/e2e/tests/04-determinism.spec.ts`.

**Checkpoint**: US8 is complete. Two clicks get events onto Kafka, and each run has one page.

---

## Phase 12: User Story 9 - More believable fraud and timing, and exports that keep every label (Priority: P3)

**Goal**: Staggered account-takeover anchors, enforced dormancy, and a daily activity curve.
The label merge in exports keeps every field with constant memory.

**Independent Test**: Account-takeover anchors are spread, dormant victims are silent, and the
hour histogram is not flat. A merged export keeps `actor_id` and `campaign_step` with flat RSS
(quickstart.md § US9).

**Depends on**: US3 (simulator and planner) and US2 (aligned label files).

### Tests for User Story 9 (write first; they must fail) ⚠️

- [ ] T182 [P] [US9] Write the property test `packages/engine/tests/property/ato-realism.test.ts`: across 200 campaigns, the anchor days pass a Kolmogorov–Smirnov test against a uniform distribution over the window at α = 0.01, and no victim has a `payment` or `income_credit` with `ts` inside its dormancy window.
- [ ] T183 [P] [US9] Write the property test `packages/engine/tests/property/activity-curve.test.ts`: the hour-of-day histogram of legitimate events matches the built-in curve (chi-square passes) and rejects a flat distribution.
- [ ] T184 [P] [US9] Extend `apps/api/tests/contract/test_exports.ts`: `include_labels:true` keeps `is_fraud`, `typology`, `actor_id`, `campaign_step` and `corruption_type` on every row, for both truth and sink sources.
- [ ] T185 [P] [US9] Write the integration test `apps/worker/tests/integration/export-memory.test.ts`: building a merged export of a 2M-event run keeps the worker's RSS growth under 100 MB, and the API's RSS is unaffected.
- [ ] T186 [P] [US9] Re-run `packages/engine/tests/property/fraud-rate.test.ts` with dormancy on, and confirm the achieved rate stays within tolerance. Tighten the fixtures in `packages/engine/tests/fixtures.ts` if needed.

### Implementation for User Story 9

- [ ] T187 [US9] Create `packages/engine/src/world/activity-curve.ts`: a 24-bin hour-of-day weight table with an alias-table sampler. Use it for intra-day timestamps in `packages/engine/src/world/simulate-day.ts`.
- [ ] T188 [US9] Spread the account-takeover anchors in `packages/engine/src/fraud/planner.ts`: uniform over the remaining horizon in history, and per day in live. Set the victim's `dormantUntilMs`. In `packages/engine/src/world/simulate-day.ts`, skip normal spending and income for dormant consumers.
- [ ] T189 [US9] Implement the lockstep merge in `apps/worker/src/jobs/export-build.ts`: zip each data file with its aligned label file (`labels/` for truth, `delivered/<sink>/labels-part-*` for sinks), keep every label field (including `delivery_outcome`), and delete the in-memory `labelsByEventId` map.
- [ ] T190 [US9] T187–T188 change generated output: in that PR, bump `ENGINE_VERSION` by one and re-baseline the golden master (`packages/engine/tests/golden-master/reference-output.json`, `history-live-equivalence` fixtures). Add the CHANGELOG "Engine output changes" entry for the activity curve, the staggered anchors and dormancy.

**Checkpoint**: All user stories are complete.

---

## Phase 13: Polish & Cross-Cutting Concerns

- [ ] T191 [P] Rebuild the agent authoring docs (`pnpm build:agent-docs`), updating `packages/agent-tools/src/docs/` for destinations, seeds as strings, `replay_history`, `estimate_run`, `list_connections` and `retry_run`.
- [ ] T192 [P] Update `README.md`:
  - the Connections and destinations overview, and the first-run flow;
  - the published reference and Kafka benchmark numbers from T096 and T164, with the hardware;
  - the optional env vars `TXLOOM_MAX_WORKER_THREADS`, `TXLOOM_MAX_STREAMS` and `TXLOOM_CONNECTIONS_JSON`.
- [ ] T193 [P] Update `docs/security.md`: connection secrets are sealed in job payloads, `managed_by: env` connections, and `ca_pem` storage.
- [ ] T194 [P] Add a status note to the top of `docs/architecture-review.md` linking `specs/003-generation-delivery-overhaul/` as the plan that addresses it.
- [ ] T195 Run every block of `specs/003-generation-delivery-overhaul/quickstart.md` against a fresh `docker compose --profile demo-brokers up`. Record the pass or fail of each block in the PR description.
- [ ] T196 Confirm the final `ENGINE_VERSION` (one bump per output-changing PR: T058, T083, T114, T151, T190). Run the golden-master, property and history-live equivalence suites green, and finalize the four `CHANGELOG.md` sections.
- [ ] T197 Run the full gate sequence from the constitution: `pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm test:integration && pnpm bench:batch-smoke && pnpm bench:smoke && pnpm test:e2e`. Then do `mvn -f analytics-flink/jobs/java/pom.xml test`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: needs Setup. Blocks every story.
- **UI Prototype (Phase 3)**: needs Foundational (T011). Blocks only the UI tasks T046–T047
  (US1), T137/T143 (US5) and T169–T178 (US8). Backend work proceeds in parallel.
- **User stories (Phases 4–12)**: need Foundational, plus the story dependencies below.
- **Polish (Phase 13)**: needs every story it documents.

### User Story Dependencies

| Story | Depends on | Notes |
|---|---|---|
| **US1** (P1, MVP) | Foundational | Independent of the engine; works on engine v1 |
| **US4** (P1) | Foundational | First engine-version bump (T058). Can run in parallel with US1 |
| **US3** (P1) | US4, US1 | Its output-changing tasks (T078–T084) need US4's versioning. T088 writes `run_destinations` (US1's T039), and T093 extends the stream start rewritten in US1's T042 |
| **US2** (P1) | US3 (day loop), US1 (destinations for replay and delivery) | |
| **US5** (P2) | US1; US2 only for replay (T136–T138 replay cases, T142, T144) | Can start after US1, in parallel with US4/US3 |
| **US6** (P2) | US3, US2 | |
| **US7** (P2) | US2 (pump), US6 (live loop) | |
| **US8** (P3) | US1, US5 | Uses US7 indicators if they are present |
| **US9** (P3) | US3 (simulator, planner), US2 (aligned labels) | |

```text
Setup → Foundational ─┬─ UI Prototype ──────────────┐
                      ├─ US1 (MVP) ─┬─ US5 ────────┴─ US8
                      │             └──────┐
                      └─ US4 ──────────── US3 ── US2 ─┬─ US6 ── US7
                                                      └─ US9
                                                               └─ Polish
```

### Within Each User Story

- Tests are written first and must fail (Constitution III), then implementation follows.
- Migrations come before repositories, repositories before services, services before routes
  and jobs, and those before UI and e2e.
- An output-changing PR bumps `ENGINE_VERSION`, re-baselines the golden master and adds the CHANGELOG entry together (T058, T083, T114, T151, T190).

### Parallel Opportunities

- Setup: T002–T004.
- Foundational: T008, T011.
- Prototype: T013–T014, T016–T017.
- **US1**: tests T020–T027; implementation T030–T031, T034–T035, T044–T045.
- **US4**: tests T050–T055 (T056 follows T052, same file); implementation T065–T066.
- **US3**: tests T067–T077; implementation T078–T079, T090, T096, T098.
- **US2**: tests T099–T112; implementation T119–T121, T130–T131.
- **US5**: tests T133–T138; implementation T145.
- **US6**: tests T147–T150; implementation T155.
- **US7**: tests T156–T160; implementation T163.
- **US8**: tests T165–T171; implementation T178–T179.
- **US9**: tests T182–T186.
- Polish: T191–T194.
- **Across stories**: once Foundational is done, US1, US4 and the UI Prototype can be worked
  on by different people at once. After US1, US5 runs alongside US4 and US3.

---

## Parallel Example: User Story 1

```text
# All US1 tests at once (different files):
T020 db-migrate (010)            apps/api/tests/integration/db-migrate.test.ts
T021 connections contract        apps/api/tests/contract/test_connections.ts
T022 kafka SASL/SCRAM/CA         packages/sinks/tests/integration/kafka-security.test.ts
T023 connection-test job         apps/worker/tests/integration/connection-test-job.test.ts
T024 destinations contract           apps/api/tests/contract/test_destinations.ts
T025 MCP parity                  apps/api/tests/contract/test_mcp_parity.ts
T026 connection form component   apps/web/tests/connection-form.test.tsx

# Then the independent implementation pieces:
T030 config schemas (kafka/rabbitmq/webhook)
T031 address warnings helper     packages/spec/src/connection-warnings.ts
T034 RabbitMQ probe   |   T035 webhook probe
T044 MCP tools        |   T045 CLI connections commands
```

## Parallel Example: User Story 2

```text
T099 transformer properties   T100 transformer state   T101 pump unit
T102 webhook v2   T103 rabbitmq confirms   T104 kafka ack
T105 exports contract   T106 deliveries contract   T107 deliver replay   T108 e2e answer-key
# Then the per-sink rewrites in parallel:
T119 kafka v2   T120 rabbitmq v2   T121 webhook v2
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup, then Phase 2 Foundational.
2. Phase 4, US1. Its UI tasks wait for the prototype (Phase 3, which runs alongside).
3. **Stop and validate**: run quickstart § US1. An authenticated Kafka cluster now receives
   streams through a saved connection. This fixes the highest-impact gap (G3) on engine v1,
   with no output change.

### Incremental Delivery (matches plan.md's delivery sequencing)

| Step | Delivers | Engine |
|---|---|---|
| 1 | Setup + Foundational + **US1** (MVP) | v1 |
| 2 | UI Prototype review, then **US5** | v1 |
| 3 | **US4**: versioning, 64-bit seeds | v2 |
| 4 | **US3**: reference scale | v3 |
| 5 | **US2**: honest answer key, replay | v4 |
| 6 | **US6**, then **US7**: live continuity, stream health | v5 |
| 7 | **US8**, **US9** | v6 |
| 8 | Polish: **T196** confirms the final version and CHANGELOG, then release | v6 |

Each step is mergeable and demoable through its quickstart block. Every output change on
`main` carries its own version bump and CHANGELOG entry.

### Parallel Team Strategy

- **Developer A**: US1, then US5, then US8, as the connections and UI track.
- **Developer B**: US4, then US3, then US2, as the engine and delivery track.
- **Developer C**: the UI Prototype, then US6, US7 and US9 once B lands US2.

---

## Notes

- `[P]` means different files with no dependency on incomplete tasks.
- A `[Story]` label maps each task to a spec user story for traceability.
- Commit after each task, or after each test-then-implementation pair.
- Contract test files backed by Testcontainers must be listed in the `integration` project
  (T001). Add any new one there.
- Never weaken a golden-master assertion to make a task pass. Re-baselining is allowed only
  together with an `ENGINE_VERSION` bump in the same PR, in the tasks that declare it.
