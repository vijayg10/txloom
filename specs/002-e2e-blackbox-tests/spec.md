# Feature Specification: End-to-End Blackbox Test Suite

**Feature Branch**: `002-e2e-blackbox-tests`

**Created**: 2026-07-18

**Status**: Draft

**Input**: User description: "I want to create an e2e functional test suite to test this application like a blackbox testing. Interview me questions one by one until you get the full clarity about the requirement."

## Clarifications

### Session 2026-07-18

- Q: Should the suite verify a live TPS-paced streaming session, or only batch runs with post-hoc inspection? → A: Batch runs only — live streaming mode is out of scope; the Stream Console is inspected after run completion.
- Q: May a failing scenario be automatically retried before the merge-blocking check reports failure? → A: One automatic retry per failed scenario; a pass-on-retry still passes the check but is reported as flaky in the suite output.
- Q: Which browser(s) must the suite drive for the Web UI scenarios? → A: A single Chromium-family browser engine; cross-browser coverage is out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Full golden-path verification through the Web UI (Priority: P1)

An engineer merging a change wants confidence that a real user can still complete the entire
TxLoom workflow — author a spec, validate it, launch a run, watch it progress, inspect the
results, and export them — without opening a browser and clicking through it by hand. The suite
drives an actual rendered browser session against the full self-hosted deployment stack (all
containers as shipped via a single startup command) using a small, fast synthetic scenario, and
fails loudly if any step in that chain breaks.

**Why this priority**: This is the single journey every other feature in TxLoom exists to
support. If it silently breaks, every other guarantee is moot. It is also the only journey that
exercises the UI, the API, the worker, and storage together as one system.

**Independent Test**: Can be fully tested by running the suite against a freshly provisioned
stack with no other test story implemented, and delivers value by catching any full-stack
regression in the core loop before merge.

**Acceptance Scenarios**:

1. **Given** a freshly provisioned deployment stack with no existing scenarios, **When** the
   suite opens the Scenario Workspace and authors a small synthetic spec, **Then** the spec is
   accepted and validation shows no errors.
2. **Given** a validated spec, **When** the suite launches a run from the Run Control surface,
   **Then** run progress becomes visible in real time and the run reaches a completed state.
3. **Given** a completed run, **When** the suite opens the Stream Console, World Inspector, and
   Ground Truth surfaces, **Then** each surface renders data consistent with the run that just
   completed.
4. **Given** a completed run, **When** the suite requests an export from the UI, **Then** the
   export completes and the produced file is retrievable and non-empty.
5. **Given** a completed run, **When** the suite opens the realism report for that run, **Then**
   the report renders without error and reflects the run's actual configuration (scale, duration).

---

### User Story 2 - Delivery correctness across all four sinks (Priority: P2)

An engineer wants assurance that events reach every delivery target TxLoom supports — file,
Kafka, RabbitMQ, and webhook — correctly, as an external consumer would observe them, not just
that the engine produced correct internal records.

**Why this priority**: Sinks are the actual product surface external systems integrate with;
a correct engine with a broken sink is a broken product from the user's point of view. This is
scoped below the core UI journey because it depends on a run already having completed correctly.

**Independent Test**: Can be tested independently by configuring one small run with all four
sinks attached and asserting each sink received the expected events, independent of whether other
stories in this suite pass.

**Acceptance Scenarios**:

1. **Given** a run configured with a file sink, **When** the run completes, **Then** the expected
   output files exist on disk with the expected event counts.
2. **Given** a run configured with a Kafka sink, **When** the run completes, **Then** a consumer
   reading the target topic observes the expected events.
3. **Given** a run configured with a RabbitMQ sink, **When** the run completes, **Then** a
   consumer reading the target queue observes the expected events.
4. **Given** a run configured with a webhook sink, **When** the run completes, **Then** a
   listener standing in for the external endpoint has received the expected calls.
5. **Given** any of the above sinks, **When** the suite inspects the default export, **Then**
   fraud/imperfection labels are absent unless the run explicitly requested their inclusion.

---

### User Story 3 - MCP-driven parity with the UI-driven flow (Priority: P3)

An engineer wants confidence that an agent driving TxLoom purely through the MCP server gets the
same outcomes as a human driving the Web UI, since TxLoom promises the UI, CLI, and MCP server are
equivalent clients of one API.

**Why this priority**: MCP is TxLoom's agent-facing integration point and a core differentiator,
but it depends on the same run lifecycle already validated by User Story 1, so it is scoped after
the UI journey.

**Independent Test**: Can be tested independently by running the same scenario lifecycle
(author, validate, run, inspect, export) purely through MCP tool calls and comparing outcomes
against an equivalent UI-driven run, without requiring the sink story to pass.

**Acceptance Scenarios**:

1. **Given** a small synthetic spec, **When** the suite submits it via MCP tools instead of the
   UI, **Then** validation results match what the UI would show for the same spec.
2. **Given** a spec accepted via MCP, **When** the suite launches and completes a run via MCP
   tools, **Then** the run reaches the same completed state and produces equivalent output to the
   UI-driven run in User Story 1.
3. **Given** a completed MCP-driven run, **When** the suite requests the ground truth and realism
   report via MCP tools, **Then** the returned data matches the UI-rendered equivalent.

---

### User Story 4 - Determinism holds under real end-to-end execution (Priority: P4)

An engineer wants proof that TxLoom's core promise — the same seed and spec always produce the
same output — holds when exercised through the full deployed stack, not just in engine-level unit
tests.

**Why this priority**: Determinism is a foundational guarantee, but verifying it is only
meaningful once a run can be reliably executed and inspected end to end (Story 1), so it is
sequenced last among the required stories.

**Independent Test**: Can be tested independently by executing the identical seed and spec twice
through the full stack and diffing the resulting artifacts, without needing the sink or MCP
stories to pass.

**Acceptance Scenarios**:

1. **Given** a small synthetic spec and a fixed seed, **When** the suite runs it twice end to end
   through the full deployed stack, **Then** the resulting truth records are byte-identical
   between the two runs.
2. **Given** the same two runs, **When** the suite compares delivered sink output (excluding
   run-identifying metadata such as timestamps of when the test itself executed), **Then** the
   delivered event payloads are identical.

---

### Edge Cases

- What happens when the deployment stack fails to become healthy within the expected startup
  window (e.g., a container fails to start)? The suite must fail clearly with which component
  didn't come up, rather than timing out ambiguously or hanging.
- What happens when one sink target (e.g., the demo Kafka broker) is temporarily unavailable when
  its run starts? The suite must report that sink's failure distinctly from failures in the other
  three sinks or in the core UI journey.
- What happens when a prior suite run left behind data (scenarios, run outputs, queued jobs)? Each
  suite execution must not be affected by state left over from a previous execution.
- What happens when browser automation cannot find or interact with an expected element (e.g., a
  UI regression changed a surface's structure)? The failure must clearly identify which surface
  and step failed, not just that "a step timed out."

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The suite MUST provision the full self-hosted deployment stack (all containers as
  shipped via a single startup command, including demo Kafka/RabbitMQ profiles) as its test
  environment for every execution.
- **FR-002**: The suite MUST drive all Web UI acceptance scenarios through real browser
  automation against actual rendered pages, not through API shortcuts standing in for the UI. A
  single Chromium-family browser engine is sufficient; cross-browser coverage is out of scope.
- **FR-003**: The suite MUST cover, via the Web UI, the full scenario lifecycle: author/edit a
  spec, validate it, launch a run, observe run progress, inspect the Stream Console, World
  Inspector, and Ground Truth surfaces after run completion, view the realism report, and trigger
  an export. Live TPS-paced streaming sessions are out of scope; all runs are batch runs.
- **FR-004**: The suite MUST verify delivery of run output through each of the four sinks (file,
  Kafka, RabbitMQ, webhook) at least once per suite execution.
- **FR-005**: The suite MUST verify that fraud/imperfection labels are excluded from a sink's
  default export output unless a run explicitly requests their inclusion.
- **FR-006**: The suite MUST drive an equivalent scenario/run lifecycle through MCP tool calls and
  verify that observable outcomes (validation results, run completion state, ground truth,
  realism report) match the UI-driven equivalent.
- **FR-007**: The suite MUST verify determinism by executing the identical seed and spec twice,
  end to end through the deployed stack, and asserting byte-identical truth records and delivered
  event payloads between the two executions.
- **FR-008**: The suite MUST use a small, fast-running synthetic scenario for all standard runs;
  it MUST NOT use the full reference scale (200k consumers / 5k merchants / 90 days) as part of
  its normal execution.
- **FR-009**: The suite MUST run automatically on every pull request as a required check that
  blocks merge on failure.
- **FR-010**: The suite MUST complete in under 5 minutes end to end (environment provisioning,
  all acceptance scenarios across all user stories, and teardown) under normal CI conditions.
- **FR-011**: The suite MUST tear down or reset all provisioned environment state (containers,
  volumes, queued jobs, produced files) between executions so that no execution is affected by
  state left over from a previous one.
- **FR-012**: The suite MUST run identically whether invoked in CI or on a developer's local
  machine, requiring no environment-specific configuration to execute.
- **FR-013**: On failure, the suite MUST report which surface, step, and acceptance scenario
  failed, with enough captured detail (e.g., logs, UI state at time of failure) to diagnose the
  failure without needing to reproduce it manually first.
- **FR-014**: The suite MUST automatically retry a failed scenario exactly once before reporting
  it as failed; a scenario that passes on retry counts as a pass for the merge-blocking check but
  MUST be flagged as flaky in the suite execution report.

### Key Entities

- **Synthetic Test Fixture**: The small, fixed seed + spec combination used across suite
  executions; deliberately far below reference scale so runs complete quickly and deterministically.
- **Sink Verification Target**: The per-sink observation point the suite reads from to confirm
  delivery (file output location, Kafka topic consumer, RabbitMQ queue consumer, webhook
  listener standing in for an external endpoint).
- **Suite Execution Report**: The pass/fail result per user story and acceptance scenario,
  including any pass-on-retry scenarios flagged as flaky, plus captured diagnostic detail on
  failure, surfaced as the required CI check.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An engineer can verify the entire spec-to-export golden path works correctly by
  triggering one suite run, with no manual UI interaction required.
- **SC-002**: The suite completes in under 5 minutes on CI infrastructure, including environment
  provisioning and teardown.
- **SC-003**: A regression in delivery correctness in any one of the four sinks is caught by the
  suite before the change merges to the main branch.
- **SC-004**: A regression that breaks byte-identical determinism for a fixed seed and spec is
  caught by the suite before the change merges to the main branch.
- **SC-005**: A divergence between MCP-driven and UI-driven outcomes for an equivalent scenario is
  caught by the suite before the change merges to the main branch.
- **SC-006**: 100% of changes merged to the main branch have passed this suite as a required,
  non-bypassable check.

## Assumptions

- The environment used to run this suite (CI runner and developer machines) can provision the
  full self-hosted deployment stack, including the optional demo Kafka/RabbitMQ profiles; this is
  already a stated project constraint, not a new one introduced here.
- A small synthetic scenario is sufficiently representative for correctness verification;
  performance and scale validation (e.g., the 1,000 events/sec Kafka benchmark) remains the
  responsibility of the existing benchmark suite, not this one.
- Existing unit, contract, component, and Testcontainers-based integration test layers remain in
  place; this suite is additive and does not replace them.
- Per explicit scope decision, invalid-spec-rejection behavior, imperfection/label correctness in
  isolation, run failure/resume/checkpointing behavior, and live TPS-paced streaming sessions are
  out of scope for this suite (left to other test layers or a future iteration), leaving
  determinism as the one cross-cutting correctness guarantee verified here.
- TxLoom has no authentication in v1 (trusted network), so the suite does not need to exercise
  any login or authorization flow.
- A webhook verification target can be a lightweight listener the suite itself stands up to stand
  in for an external endpoint.
- The CLI client is not covered by this suite; only the Web UI and MCP server are in scope, per
  explicit scope decision.
