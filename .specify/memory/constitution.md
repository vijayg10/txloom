<!--
Sync Impact Report
==================
Version change: (template, unversioned) → 1.0.0
Rationale: Initial ratification — all placeholder tokens replaced with concrete
principles derived from CONCEPT_NOTE.md and the user's four focus areas
(code quality, testing standards, user experience consistency, performance).

Modified principles: n/a (initial adoption; template placeholders filled)
Added sections:
  - Core Principles (I–V)
  - Technology & Architecture Constraints (was [SECTION_2_NAME])
  - Development Workflow & Quality Gates (was [SECTION_3_NAME])
  - Governance (rules filled)

Removed sections: none

Templates requiring updates:
  - .specify/templates/plan-template.md — ✅ compatible (generic Constitution
    Check gate; plans must instantiate the five gates listed in Development
    Workflow & Quality Gates)
  - .specify/templates/spec-template.md — ✅ compatible (mandatory Success
    Criteria section satisfies Principles IV & V measurability requirements)
  - .specify/templates/tasks-template.md — ✅ updated ("Tests OPTIONAL" note
    replaced to reflect Principle III test-first mandate)
  - .specify/templates/checklist-template.md — ✅ compatible (no constitution
    references)

Follow-up TODOs: none

Amendment 1.0.1 (2026-07-11): v1 sink set changed by product decision — ledger
seeder removed, RabbitMQ sink added (sinks remain four: files, Kafka, RabbitMQ,
webhook). Principle III integration-test list updated accordingly. PATCH bump.
-->

# TxLoom Constitution

## Core Principles

### I. Code Quality & Type Safety

TypeScript in `strict` mode is mandatory end to end — API, workers, engine,
and UI. `any` and unchecked type assertions are prohibited except at
validated external boundaries (parsed spec input, sink payloads), where a
schema-validated type MUST be established immediately. Linting and formatting
run in CI and MUST pass before merge; warnings are treated as errors.
Extensibility points (sinks, fraud typologies, imperfection types) MUST be
expressed as documented plugin interfaces rather than conditionals woven
through the engine — v1 ships exactly three typologies, four sinks, and four
imperfection types, and everything beyond that arrives through those
interfaces. Dead code, commented-out blocks, and speculative abstractions
MUST NOT be merged.

**Rationale**: The engine's correctness claims (determinism, labeled ground
truth) are only as trustworthy as the code enforcing them, and the plugin
surface is the project's community-growth mechanism — it must stay clean.

### II. Deterministic & Reproducible by Construction (NON-NEGOTIABLE)

Same seed + same spec = byte-identical truth output, always. Every source of
randomness MUST flow from the seeded, per-partition RNG streams; `Math.random`,
wall-clock reads inside generation logic, and iteration-order-dependent
behavior are forbidden in the engine. The LLM compiles and patches specs; it
MUST NEVER generate transactions or influence engine output. The imperfection
layer corrupts only the labeled delivery copy — the truth record is immutable.
Completed runs are immutable records permanently linking spec snapshot, seed,
realism report, and outputs. Any change that alters generated output for an
existing seed+spec pair is a breaking change and MUST be versioned and
documented as such.

**Rationale**: "Regenerate exactly this dataset" is a headline product
guarantee ("LLM proposes, engine enforces"); it cannot be retrofitted onto a
nondeterministic core.

### III. Test-First Development

Tests are written before implementation for all engine, validator, and API
code: red → green → refactor. Required coverage by construct:

- Every semantic invariant in the spec validator MUST have tests for both the
  rejection case and the explanation message the repair loop consumes.
- The engine core MUST have golden-master tests: fixed seed + fixed spec
  asserted against committed reference output, run in CI on every change.
- Statistical properties (target fraud rate, distribution parameters,
  imperfection rates) MUST be verified with seeded property tests using
  tolerance bounds, not exact-value assertions.
- Every REST/WebSocket endpoint MUST have contract tests; sink integrations
  (Kafka, RabbitMQ, webhook) MUST have integration tests against real or
  containerized dependencies.

UI component tests are required for the diff-review, spec-editor, and export
surfaces; visual polish iterations are exempt from test-first ordering.

**Rationale**: The product sells ground truth. A generator whose own
correctness is unverified has no credible answer key.

### IV. User Experience Consistency

The UI, CLI, and future MCP server are pure clients of one REST/WebSocket
API — no capability may exist in one client without an API endpoint the
others can reach. Every error shown to a user MUST state what is wrong, where
(spec path or field), and how to fix it: the Diwali-outside-clock class of
mistake is an inline explanation at edit time, never a failed run. All spec
mutations — human or LLM — go through the same validate-and-diff-review flow;
NL edits produce reviewable spec diffs, never silent regeneration. Label
export defaults to the separate answer key, and any path that includes labels
in the main export MUST warn explicitly. Setup is `docker compose up` with
zero required config-file editing; all configuration is operable from the
Connections & settings surface. Terminology (scenario, spec, run, world,
typology, sink) MUST be used identically across UI, CLI, API, and docs.

**Rationale**: One API surface, three clients is the architecture; consistent
mental models (spec-as-source-of-truth, diff-as-review) are the product's
differentiator against prompt-in/rows-out competitors.

### V. Performance as a Measured Requirement

Performance claims MUST be numbers, not adjectives. The v1 definition of done
includes a published, reproducible benchmark: sustained TPS to Kafka with
flat memory over the full run. Every feature spec touching the generation or
delivery path MUST declare its performance budget (throughput, latency, or
memory) in its Success Criteria, and CI MUST run a benchmark smoke test that
fails on regression beyond an agreed threshold. Streaming mode MUST hold the
configured TPS within tolerance and expose achieved-vs-target throughput,
sink lag, and backpressure as observable metrics. Generation MUST scale via
partitioned parallel workers with idempotent resume; memory usage MUST stay
flat with respect to run length (streaming, not accumulating). CPU-bound
work runs in worker threads, never on the API event loop.

**Rationale**: "Sustains X TPS with flat memory" is part of the public v1
promise and the ShadowTraffic comparison; an unmeasured budget is a slogan.

## Technology & Architecture Constraints

- **Stack**: TypeScript end to end; Fastify (or NestJS) API + job
  orchestration; BullMQ workers over Redis for chunked parallel generation;
  Postgres for scenarios, specs, and run metadata; React + Recharts
  dashboard; Node `worker_threads` for CPU-bound generation.
- **Distribution**: The product ships as one `docker compose up`. Any new
  service or dependency MUST be justified against this constraint in the
  plan's Complexity Tracking table.
- **Spec as source of truth**: The simulation spec is JSON, validated by
  JSON Schema plus semantic invariants, hand-editable, and versioned in git.
  No component may hold authoritative state that bypasses the spec.
- **License & openness**: Apache-2.0. No feature may depend on a
  closed-source or hosted-only component for core functionality; the engine
  MUST work without any LLM configured.
- **Scope discipline**: v1 boundaries (3 typologies, 4 sinks, 4 imperfection
  types; recon views and MCP deferred to v1.1) are binding. Scope additions
  require a constitution-level decision, not a PR.

## Development Workflow & Quality Gates

Every PR MUST pass, in order:

1. **Static gate**: typecheck (strict), lint, format — zero errors, zero
   warnings.
2. **Test gate**: unit, property, contract, and golden-master suites green;
   new engine/validator/API code demonstrably test-first (tests present in
   the same PR, covering failure cases).
3. **Determinism gate**: golden-master outputs unchanged, or the change is
   explicitly declared breaking with version bump and changelog entry.
4. **Performance gate**: benchmark smoke test within regression threshold
   for changes touching generation or delivery paths.
5. **Review gate**: at least one review verifying constitution compliance;
   violations require a filled Complexity Tracking justification in the
   feature's plan.md or MUST be rejected.

Feature work follows the Spec Kit flow: constitution → specify → plan →
tasks → implement. Plans MUST include a Constitution Check section that
instantiates the five gates above against the feature's specifics.

## Governance

This constitution supersedes all other development practices in this
repository. Amendments are made by editing this file via PR: the PR MUST
state the version bump type with rationale, update the Sync Impact Report,
and propagate changes to dependent templates in `.specify/templates/` in the
same change.

Versioning policy (semantic): MAJOR for removals or redefinitions of
principles or backward-incompatible governance changes; MINOR for new
principles or materially expanded guidance; PATCH for clarifications and
wording fixes.

Compliance review: every plan's Constitution Check is the enforcement point
before implementation; every PR review verifies the five quality gates.
Complexity that violates a principle MUST be justified in the plan's
Complexity Tracking table or the approach MUST be simplified. Runtime
development guidance lives in `CLAUDE.md` and MUST NOT contradict this
document.

**Version**: 1.0.1 | **Ratified**: 2026-07-11 | **Last Amended**: 2026-07-11
