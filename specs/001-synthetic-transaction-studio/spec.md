# Feature Specification: TxLoom — Synthetic Transaction Studio (v1)

**Feature Branch**: `001-synthetic-transaction-studio`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "refer the file CONCEPT_NOTE.md" — TxLoom, an open-source, self-hosted payments world simulator. It models a population of consumers, merchants, and fraud actors behaving over time — salaries, spending rhythms, seasonal spikes, fraud campaigns — and emits the resulting transactions wherever needed: files for ML teams, live streams or webhooks at controlled rates for platform testing. Every event carries hidden ground-truth labels. A natural-language interface compiles plain-English scenario descriptions into an underlying simulation spec, but the spec — versioned, validated, hand-editable — is the source of truth, not the prompt. One-line pitch: "A simulated financial world — with the answer key."

## Problem & Audience *(context)*

Everyone building or testing financial software needs transaction data, and nobody has it. Real payment data is locked behind privacy regulation and commercial sensitivity. Three audiences are served by v1:

- **Fraud and AML teams** cannot train or benchmark models without labeled fraud examples, which are by definition a fraction of a percent of real volume.
- **Platform teams** testing payment switches, reconciliation systems, and fraud pipelines need realistic *event streams* with realistic *failure modes* — duplicates, late arrivals, out-of-order delivery — not just clean static files.
- **Fintech product developers** need seed data that behaves like real customers: rent on the 3rd, salary on the 1st, festival-week spikes, the occasional bounced transfer.

The differentiators no competitor combines: a behavioral world model (simulating causes, not plausible rows), ground-truth answer keys, a labeled imperfection engine, history-to-live continuity from the same world state, and open-source self-hosting. The natural-language interface is the on-ramp, not the engine: the language model proposes a spec, the deterministic engine enforces it, and it never generates transactions itself.

## Clarifications

### Session 2026-07-11

- Q: Do generated transactions carry an outcome/status in v1, or is every event a successful payment? → A: Minimal status set — every transaction carries one of approved, declined, or reversed/refund; card testing produces realistic decline patterns, refund abuse produces refund events, and baseline decline rates are configurable.
- Q: How long are run outputs (datasets, truth records, answer keys, realism reports) retained? → A: Until manual delete — outputs persist until the user deletes the run from the UI; deleting a run keeps its immutable metadata (spec snapshot + seed) so the dataset remains regenerable.
- Q: How does v1 handle currency in generated transactions? → A: Single currency per scenario — each scenario declares one currency (e.g., INR for the UPI-style template) and all amounts and distributions are denominated in it.
- Q: How do users obtain ground-truth labels for events delivered in live streaming mode? → A: Parallel label channel — labels publish in real time to a separate channel on the same sink (dedicated Kafka topic / RabbitMQ queue), opt-in per stream; truth is also recorded for later export.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a deterministic, labeled dataset from a scenario spec (Priority: P1)

A fraud data scientist defines a simulation scenario — population of consumers and merchants, spending rhythms, seasonality, fraud typologies, data imperfections — as a structured, hand-editable spec. They validate it, run it for a simulated period (e.g., 90 days), and download the resulting transaction files plus a separate answer key labeling exactly which events are fraudulent (and by which typology and actor) and which delivered records were deliberately corrupted (and how). Re-running the same spec with the same seed reproduces the identical dataset.

**Why this priority**: This is the irreducible core — the world model, ground truth, and answer key are the product's novelty. Every other story builds on a working generate-with-labels loop. Without it there is no product; with only it, there is already a usable one.

**Independent Test**: Author a spec directly in the spec editor (no natural language needed), run it, download files and the label set, and verify: labels reconcile with the data, fraud rate approximates the configured target, imperfections appear in the delivery and are fully enumerated in the answer key, and a second run with the same seed and spec produces identical output.

**Acceptance Scenarios**:

1. **Given** a valid spec defining 200,000 consumers across weighted archetypes (e.g., salaried urban with month-start salary credits and lognormal income, gig workers with irregular weekly income), 5,000 merchants across weighted categories with per-category amount distributions, a 90-day simulated clock, seasonality events with volume multipliers, a 1.2% fraud target across three typologies, and imperfection rates, **When** the user launches a run, **Then** the system generates the full transaction history and produces downloadable data files plus a separate ground-truth label export.
2. **Given** a completed run, **When** the user relaunches with the identical spec and seed, **Then** the output is identical — same events, same labels, always.
3. **Given** a spec with a seasonality event scheduled outside the simulation clock window, **When** the user validates or attempts to run it, **Then** the system rejects it before generation with an explanation of what is wrong and where (this class of spec is syntactically well-formed but semantically dead, and must never silently produce a run without the intended effect).
4. **Given** a configured fraud target rate and typology shares (e.g., 50% card testing, 30% account takeover, 20% refund abuse), **When** a run completes, **Then** every fraudulent event is traceable to the actor and typology that produced it, and the achieved fraud rate is reported against the target.
5. **Given** configured imperfections (duplicate delivery, late arrival, out-of-order, clock skew between sources), **When** the run's output is delivered, **Then** the corruption affects only the delivered copies — the underlying truth record is never corrupted — and every corrupted record is identified in the answer key with its corruption type.
6. **Given** an account-takeover typology configured with a dormancy precondition (e.g., dormant ≥ 30 days) and drain behavior, **When** the run executes, **Then** takeover events occur only against accounts satisfying the precondition and follow the typology's multi-step script woven into legitimate traffic over the simulated clock.

---

### User Story 2 - Describe a scenario in plain English and edit it conversationally (Priority: P2)

A user types a plain-English description — "A UPI-style instant payment network in India. 200k consumers, 5k merchants across groceries, fuel, food delivery and electronics. Salary credits at month start, spike during Diwali week. Include 1.2% fraud: card-testing bursts, account takeover after dormancy, and refund abuse. Add realistic mess: 0.5% duplicate webhooks, occasional late-arriving events. 90 days of history, then stream live at 50 TPS." — and the system compiles it into a validated simulation spec. Later, the user types "Raise fraud to 2% and add a mule ring of 15 accounts" and reviews the resulting change as a diff — accepting or rejecting individual hunks like a code review — rather than receiving a silently regenerated spec.

**Why this priority**: The natural-language on-ramp is the accessibility layer that makes the studio usable without learning the spec format first. It is deliberately second: the spec is the source of truth and the engine works without any language model configured.

**Independent Test**: Enter a scenario description in the prompt panel, receive a spec that passes validation, verify it opens in the editor for inspection and hand-editing; then submit a natural-language edit and verify a reviewable diff is produced whose accepted hunks change the spec accordingly.

**Acceptance Scenarios**:

1. **Given** a plain-English scenario description, **When** the user compiles it, **Then** the system produces a structured spec covering persona archetypes, merchant catalogs, temporal patterns, fraud typology configuration, and imperfection profiles, and the spec passes structural validation and semantic-invariant checks before anything runs.
2. **Given** a compiled spec that fails validation, **When** the compilation pipeline runs, **Then** invalid output bounces through a repair loop driven by the validator's explanations, and the user receives either a valid spec or a clear failure message — never an invalid spec presented as ready.
3. **Given** an existing spec and a natural-language edit request, **When** the user submits it, **Then** the system produces a spec diff for review — not a regenerated spec — and the user can accept or reject individual changes before anything is applied.
4. **Given** a user with no language-model provider configured, **When** they use the product, **Then** every capability except natural-language compile/edit remains fully functional — specs can be authored by hand or from templates.
5. **Given** a saved scenario, **When** the user edits it over time, **Then** every saved version is retained in a version history with one-click rollback.

---

### User Story 3 - Control runs and inspect the generated world (Priority: P3)

An operator launches runs from a scenario with run-scoped parameters (seed, scale override, sink selection), watches progress (per-partition progress bars, throughput, ETA), can pause, cancel, or resume a run without duplicating work, and reviews the finished world visually: volume over time with seasonality overlays, amount distributions per category, persona activity heatmaps, the fraud-injection timeline, and an audit of what was corrupted where. Every completed run is an immutable record — spec snapshot, seed, quality report, and outputs permanently linked — so "regenerate exactly this dataset" is a button. Every run produces a realism report: distribution summaries per category, inter-arrival statistics, achieved-vs-target fraud rates, seasonality effect sizes, and comparisons against published reference benchmarks where available.

**Why this priority**: Iterating on a scenario visually — instead of grepping a CSV — and trusting the output via the realism report are what make the generate loop usable and credible. It answers "how do I know this is realistic?", the norm that ML users expect.

**Independent Test**: Launch a run from an existing scenario, observe live progress, pause and resume it, then open the completed run: verify the world inspector renders its charts, the realism report is present with all its sections, the run record links spec snapshot + seed + report + outputs immutably, and two runs can be compared side by side.

**Acceptance Scenarios**:

1. **Given** a scenario, **When** the user launches a run, **Then** they can set run-scoped parameters (seed, scale override, sink selection) without modifying the scenario itself.
2. **Given** a run in progress, **When** the user views it, **Then** they see status, per-partition progress, throughput, and estimated completion, with access to logs and pause/cancel controls.
3. **Given** an interrupted or paused run, **When** the user resumes it, **Then** generation continues from where it left off without duplicating or losing events in the truth record.
4. **Given** a completed run, **When** the user opens its record, **Then** the spec snapshot, seed, realism report, and outputs are permanently linked and unmodifiable, and a single action regenerates exactly the same dataset.
5. **Given** a completed run, **When** the user opens the world inspector, **Then** they can view volume over time with seasonality overlays, per-category amount distributions, persona activity heatmaps, the fraud-injection timeline, and the imperfection audit (what was corrupted, where, with labels).
6. **Given** a completed run, **When** the realism report is rendered, **Then** it includes distribution summaries per category, inter-arrival statistics, achieved-vs-target fraud rates, seasonality effect sizes, and reference-benchmark comparisons where public aggregates exist for the scenario's domain, with sources documented.
7. **Given** any two completed runs, **When** the user selects them for comparison, **Then** the system presents their worlds and reports side by side.

---

### User Story 4 - Continue the same world as a live stream at controlled rate (Priority: P4)

A platform engineer generates 90 days of history as files, then has the *same world state* continue as a live event stream at a controlled events-per-second rate into their streaming platform (Kafka), message broker (RabbitMQ), or webhook endpoints. From a stream console they start, stop, and pause the stream, adjust the rate with a dial showing live achieved-vs-target throughput, watch sink lag and backpressure indicators, and sample the stream in a real-time event ticker. Dialing the rate up while a downstream consumer dashboard reacts is the 30-second wow moment.

**Why this priority**: History-to-live continuity from one world state is a headline novelty (batch tools and streaming tools exist; a world that does both is unclaimed), but it requires the P1 engine and benefits from P3 run infrastructure first.

**Independent Test**: Run a scenario configured with history-then-stream, verify the live phase continues the same personas and world state (no discontinuity in actors or balances), verify delivered throughput tracks the configured rate, change the rate live, and pause/resume the stream.

**Acceptance Scenarios**:

1. **Given** a scenario configured for history followed by live streaming at a target rate, **When** the history phase completes, **Then** the live phase continues from the same world state — the same population, actor states, and in-progress behavioral patterns.
2. **Given** a live stream, **When** the user adjusts the target rate, **Then** delivered throughput converges on the new target and the console displays live achieved-vs-target rate.
3. **Given** a downstream sink that slows or stalls, **When** the stream continues, **Then** the system applies backpressure rather than dropping or corrupting events beyond configured imperfections, and surfaces sink lag and backpressure state in the console.
4. **Given** a live stream, **When** the user pauses and later resumes it, **Then** the stream continues without breaking world-state continuity.
5. **Given** streaming delivery, **When** imperfections are configured for stream sinks (e.g., duplicate delivery), **Then** they are injected into the delivered stream and recorded in the answer key exactly as in batch mode.

---

### User Story 5 - Explore ground truth and control label exports (Priority: P5)

An ML engineer filters the generated world by fraud typology and drills into an individual fraud actor's *story* — for example, an account-takeover actor's timeline from dormancy through the credential-change signal to the drain transactions, rendered as a sequence. From the same surface they control exports: with or without labels, per output format, with an explicit warning whenever labels are included in the main export rather than the separate answer key.

**Why this priority**: Actor stories and export ergonomics deepen trust and usability for the fraud/ML audience, but labels are already exportable via files from P1 — this story is the exploration and safety layer on top.

**Independent Test**: After a completed run with fraud, filter events by typology, open one actor's timeline and verify it renders the typology's multi-step sequence; export a dataset with labels merged into the main export and verify the explicit warning; export with the separate answer key and verify no label fields leak into the main data.

**Acceptance Scenarios**:

1. **Given** a completed run, **When** the user filters ground truth by typology, **Then** they see the matching events and the actors behind them.
2. **Given** a fraud actor, **When** the user opens its story, **Then** the actor's full behavioral timeline is rendered as a sequence (e.g., dormancy → credential-change signal → drain transactions for account takeover).
3. **Given** an export request without labels, **When** the export completes, **Then** no ground-truth fields (fraud flag, typology, actor identity, corruption type) appear in the exported data, and the answer key is available as a separate export.
4. **Given** an export request that merges labels into the main export, **When** the user configures it, **Then** the system requires acknowledgment of an explicit warning that the answer key will be embedded in the test surface.

---

### User Story 6 - Operate everything from the studio, configure nothing on disk (Priority: P6)

An operator manages delivery destinations (Kafka clusters, RabbitMQ brokers, webhook endpoints) with test-connection buttons and stored credentials, configures the language-model provider, and sets global defaults — all from the settings surface. A template gallery (UPI-style instant payments, card-present retail, mobile money, marketplace payouts) lets any user clone and modify a working scenario instead of starting blank. Nothing requires editing a configuration file on disk, and the entire product installs and starts with a single command on the user's own infrastructure.

**Why this priority**: Connections, templates, and zero-config operation complete the studio experience and the self-hosted promise, but each earlier story is independently valuable without them (destinations can carry defaults; specs can start blank).

**Independent Test**: From a fresh install started with a single command, add a streaming destination and a webhook endpoint via the UI, test both connections, configure a language-model provider, clone a template into a new scenario, and run it — without touching any file on disk.

**Acceptance Scenarios**:

1. **Given** a fresh machine meeting documented prerequisites, **When** the user runs the single documented install/start command, **Then** the full product (engine, studio UI, and dependencies) is running and usable.
2. **Given** the settings surface, **When** the user adds a delivery destination, **Then** they can store credentials securely and verify it with a test-connection action before any run uses it.
3. **Given** the template gallery, **When** the user selects a template (UPI-style, card-present retail, mobile money, or marketplace payouts), **Then** a new scenario is created as an editable copy.
4. **Given** any product capability, **When** the user needs it, **Then** it is operable from the web UI; the command-line interface is an automation convenience over the same capabilities, not a requirement.

---

### Edge Cases

- **Semantically dead specs**: structurally valid configuration that cannot take effect (seasonality window outside the clock window; typology shares not summing to 1; archetype weights inconsistent; imperfection targeting a sink not selected for output) must be rejected at validation time with a located explanation, not discovered after a wasted run.
- **Repair loop exhaustion**: if natural-language compilation cannot reach a valid spec after repair attempts, the user gets the best candidate plus the outstanding validation errors for hand-editing — never a silent failure or an invalid spec marked ready.
- **Interrupted generation**: process or infrastructure failure mid-run must not corrupt the truth record; resume continues without duplicated or missing truth events (duplicates in *delivery* exist only as configured, labeled imperfections).
- **Unreachable destination**: a stream or webhook destination going down mid-delivery triggers backpressure/retries and surfaces the condition; configured signed webhook deliveries retry; the run does not silently drop data.
- **Extreme scale requests**: population or duration far beyond the documented v1 envelope should be rejected or warned about with the documented limits, not accepted and left to fail mid-run.
- **Zero or extreme fraud rates**: a 0% fraud scenario runs cleanly with an empty fraud answer key; very high target rates still report achieved-vs-target honestly.
- **Precondition-starved typologies**: if account takeover requires ≥30-day dormancy but the population/duration makes eligible accounts scarce, the shortfall is surfaced in the realism report rather than silently substituting ineligible targets.
- **Edits during active runs**: a scenario edited while one of its runs executes must not affect that run — the run's spec snapshot is immutable.
- **Concurrent runs**: multiple simultaneous runs (same or different scenarios) remain isolated, each deterministic for its own seed.
- **Label leakage**: no export path may include ground-truth fields without the explicit-warning acknowledgment; the answer key never leaks into the test surface unless requested.
- **Clock-skew sources**: per-source clock offsets (e.g., an acquirer feed skewed by +05:30) apply only to delivered timestamps of that source, remain labeled, and never alter truth-record time.
- **Streaming ahead of real time**: the live phase emits at the configured rate on the real clock while remaining consistent with the simulated world's virtual clock semantics.

## Requirements *(mandatory)*

### Functional Requirements

#### Scenario spec — the source of truth

- **FR-001**: The system MUST represent every scenario as a structured, human-readable, hand-editable spec that fully determines simulation behavior; the spec (not any prompt) is the single source of truth for a run.
- **FR-002**: The spec MUST support: a random seed; a single scenario currency in which all amounts and distributions are denominated (e.g., INR for the UPI-style template); a simulated clock (start date, duration in days, optional follow-on live-stream rate); a consumer population with a count and weighted archetypes, each with income patterns (e.g., fixed credit day with a statistical amount distribution, or irregular weekly income) and spend rhythms (e.g., daily transaction count distribution, weekend multiplier); a merchant population with a count and weighted categories each carrying an amount distribution; seasonality events with date windows and volume multipliers; a fraud section with a target rate and typology configurations with shares; an imperfections section; and an output section selecting sinks and label-export mode.
- **FR-003**: The system MUST validate every spec against (a) a formal structural schema and (b) a battery of semantic invariants (e.g., every seasonality window must intersect the simulation clock window; shares and weights must be coherent) before any generation runs.
- **FR-004**: Semantic-invariant violations MUST produce explanations that state what is wrong, where in the spec, and why — actionable both by a human editor and by the automated repair loop.
- **FR-005**: The system MUST keep a version history for every scenario with one-click rollback to any prior version.
- **FR-006**: The system MUST provide a template gallery with at least four starter scenarios — UPI-style instant payments, card-present retail, mobile money, and marketplace payouts — cloneable into editable scenarios.
- **FR-007**: Default distributions and calibrations MUST be documented with their sources (e.g., published national payment-system aggregates for the India/UPI-style template), and every default distribution MUST be overridable in the spec.

#### Natural-language compile and edit

- **FR-008**: The system MUST compile a plain-English scenario description into a spec covering persona archetypes, merchant catalogs, temporal patterns, network topology, fraud typology configuration, and imperfection profiles.
- **FR-009**: Compiled specs MUST pass the full validation battery before being presented as ready; invalid candidates MUST route through a repair loop that consumes the validator's explanations, with a bounded number of attempts and a clear failure hand-off (best candidate plus outstanding errors) if repair fails.
- **FR-010**: A natural-language edit to an existing spec MUST produce a reviewable spec diff — with per-change accept/reject — and MUST NOT regenerate or silently rewrite the spec.
- **FR-011**: The language model MUST NEVER generate transactions or influence generated output; its role is limited to compiling descriptions into specs and proposing spec diffs.
- **FR-012**: All product capabilities except natural-language compile/edit MUST function with no language-model provider configured.

#### Deterministic generation engine

- **FR-013**: Generation MUST be deterministic: the same seed and same spec MUST produce identical output, always, including under parallel execution (workers receive deterministic partitions of the persona space with independent per-partition random streams).
- **FR-014**: The engine MUST simulate a behavioral world over a virtual clock: persona agents wake on their schedules and transact per their archetype's income and spending rhythms; merchant activity follows category weights and amount distributions; seasonality windows multiply volume as configured.
- **FR-015**: Fraud actors MUST execute multi-step typology scripts woven into legitimate traffic over the simulated clock — not injected as isolated rows.
- **FR-015a**: Every generated transaction MUST carry an outcome status from a minimal set — approved, declined, or reversed/refund — produced by the world model: card-testing bursts yield realistic decline patterns, refund-abuse typologies produce refund events, and legitimate traffic carries a configurable baseline decline rate.
- **FR-016**: v1 MUST ship exactly three fraud typologies: card testing (configurable burst size ranges, burst windows, and small-amount ranges), account takeover (configurable dormancy precondition and drain behavior, e.g., drain via peer-to-peer transfers), and refund abuse. Typology shares of the fraud target rate MUST be configurable.
- **FR-017**: The engine MUST target the configured overall fraud rate and report the achieved rate against it per run.
- **FR-018**: Generation MUST execute as resumable parallel work with per-partition progress reporting; interrupted runs MUST resume idempotently without duplicating or losing truth events.
- **FR-019**: The engine MUST scale to at least the reference scenario — 200,000 consumers, 5,000 merchants, 90 simulated days — within the documented performance envelope.

#### Ground truth and labels

- **FR-020**: Every generated event MUST be traceable to the actor that produced it and, when fraudulent, to the typology and fraud actor responsible.
- **FR-021**: Ground-truth labels (fraud flag, typology, actor identity, corruption type) MUST be exportable as a separate answer key, and MUST be excluded from the main export by default.
- **FR-022**: Including labels in the main export MUST require explicit user acknowledgment of a warning.

#### Labeled imperfection engine

- **FR-023**: v1 MUST ship exactly four imperfection types, each configurable by rate and parameters: duplicate delivery (with per-sink targeting), late arrival (with a statistical delay distribution), out-of-order delivery, and clock skew (per-source timestamp offsets, e.g., an acquirer feed offset by a fixed duration).
- **FR-024**: Imperfections MUST corrupt only delivered copies; the truth record MUST never be corrupted.
- **FR-025**: Every injected imperfection MUST be labeled in the answer key — the exact records that deduplication, ordering, or reconciliation logic should have caught are enumerable.

#### Delivery (sinks)

- **FR-026**: v1 MUST ship exactly four delivery destinations: (1) files in CSV, Parquet, and JSON formats with the label set alongside; (2) a Kafka producer with configurable partitioning and a controlled events-per-second rate with backpressure; (3) a RabbitMQ publisher with configurable exchange/routing and the same rate control and backpressure behavior; (4) signed webhook delivery with retries.
- **FR-027**: Additional sinks, fraud typologies, and imperfection types beyond the v1 set MUST be attachable through documented extension interfaces, with contribution guidance inviting community additions.
- **FR-028**: Delivery rate control MUST hold the configured target rate and expose achieved-vs-target throughput, sink lag, and backpressure state as live, observable indicators.

#### History-to-live continuity

- **FR-029**: A scenario MUST be able to generate a historical period as files and then continue the same world state as a live stream at a configured rate — same population, same actor states, no reset between phases.
- **FR-030**: Live streams MUST support start, stop, pause, and resume, and live adjustment of the target rate, all without breaking world-state continuity.
- **FR-030a**: In live streaming mode, ground-truth labels MUST be available in real time via an opt-in parallel label channel on the same sink (e.g., a dedicated Kafka topic or RabbitMQ queue, separate from the event channel), so running pipelines can be scored live; streamed truth MUST also be recorded for later export, and the default remains labels-off on the event channel itself.

#### Runs and reproducibility

- **FR-031**: Users MUST be able to launch runs from a scenario with run-scoped parameters — seed, scale override, sink selection — without modifying the scenario.
- **FR-032**: Active runs MUST expose status, per-partition progress, throughput, estimated completion, and logs, with pause/cancel controls.
- **FR-033**: Completed runs MUST be immutable records permanently linking the spec snapshot, seed, realism report, and outputs; a single action MUST regenerate exactly the same dataset.
- **FR-033a**: Run outputs (datasets, truth records, answer keys, realism reports) MUST be retained until the user explicitly deletes the run from the UI; deletion reclaims output storage but MUST preserve the run's immutable metadata (spec snapshot + seed) so the identical dataset remains regenerable.

#### Realism report

- **FR-034**: Every run MUST produce a realism report containing: distribution summaries per category, inter-arrival statistics, achieved-vs-target fraud rates, seasonality effect sizes, and comparisons against published reference benchmarks where public aggregates exist for the scenario's domain, with sources cited.

#### Studio UI and interface parity

- **FR-035**: Every capability MUST be operable from the web UI; the command-line interface is an automation convenience over the same capabilities, never the only path.
- **FR-036**: The UI MUST provide six surfaces: (1) a scenario workspace with a natural-language prompt panel, a split view pairing a spec editor (schema-aware autocompletion, inline semantic-invariant errors shown at edit time with explanations) with a live structural preview (population summary, typology list, imperfection profile, estimated volume), a diff review panel for natural-language edits, the template gallery, and version history; (2) run control with run list, run detail, and the immutable run record; (3) a stream console with rate dial, live achieved-vs-target throughput, sink lag and backpressure indicators, and a real-time event ticker sampling the stream; (4) a world inspector with volume-over-time and seasonality overlays, per-category amount distributions, persona activity heatmaps, fraud-injection timeline, imperfection audit, the rendered realism report, and side-by-side comparison of any two runs; (5) a ground-truth explorer with typology filtering, per-actor story timelines, and export controls with the label-inclusion warning; (6) connections & settings for sink management (test-connection actions, credential storage), language-model provider configuration, and global defaults.
- **FR-037**: The UI, the command-line interface, and future programmatic agent integrations MUST all be clients of one and the same service interface — one capability surface, multiple clients.
- **FR-038**: Spec validation feedback MUST appear inline at edit time (the seasonality-outside-clock class of mistake is an explained editor annotation, not a failed run).

#### Distribution and openness

- **FR-039**: The product MUST be installable and startable on the user's own infrastructure with a single documented command, with no configuration file editing required for first use.
- **FR-040**: The product MUST be released as open source under the Apache-2.0 license, and core functionality MUST NOT depend on any closed or hosted-only service.
- **FR-041**: A documented performance budget with a published, reproducible benchmark — sustained 1,000 events per second to the Kafka sink with flat memory — is part of the v1 definition of done.

### Key Entities

- **Scenario**: A named, versioned container for a simulation definition; holds the spec's version history and links to its runs and templates.
- **Simulation Spec**: The structured source of truth for one scenario version: seed, clock, population (consumer archetypes, merchant catalog), seasonality events, fraud configuration, imperfection profile, and output selection.
- **Template**: A pre-built, documented scenario (UPI-style, card-present retail, mobile money, marketplace payouts) cloneable into a new scenario.
- **Persona / Consumer Archetype**: A weighted behavioral class — income pattern (credit day and amount distribution, or irregular patterns) and spend rhythm (transaction-count distribution, weekend and seasonal multipliers) — instantiated as individual consumer agents.
- **Merchant / Merchant Category**: Weighted categories (e.g., groceries, fuel, food delivery, electronics) with per-category amount distributions, instantiated as individual merchants.
- **Fraud Actor / Typology Configuration**: An actor executing a typology script (card testing, account takeover, refund abuse) with its parameters (share, burst shape, preconditions, behavior) — the traceable cause behind every fraudulent event.
- **Seasonality Event**: A named date window with a volume multiplier applied to the world's activity.
- **Imperfection Profile**: Configured rates and parameters for duplicate delivery, late arrival, out-of-order delivery, and per-source clock skew.
- **Run**: One execution of a spec snapshot with a seed and run-scoped parameters; carries live progress while active and becomes an immutable record (spec snapshot + seed + realism report + outputs) when complete.
- **Truth Event**: An immutable generated transaction as the world actually produced it, with full causal traceability and an outcome status (approved, declined, or reversed/refund).
- **Delivered Event**: A truth event's copy as emitted through a sink, possibly corrupted by labeled imperfections.
- **Answer Key / Label Set**: The separate export enumerating ground truth: fraud flag, typology, actor identity, and corruption type per affected record.
- **Realism Report**: The per-run quality evidence: distribution summaries, inter-arrival statistics, achieved-vs-target rates, seasonality effect sizes, benchmark comparisons with sources.
- **Sink Connection**: A configured delivery destination (file target, Kafka cluster, RabbitMQ broker, webhook endpoint) with stored credentials and test-connection state.
- **Spec Diff**: A reviewable set of proposed spec changes (from a natural-language edit) with per-hunk accept/reject state.
- **Language-Model Provider Configuration**: User-supplied provider settings enabling the optional compile/edit features.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Reproducibility is absolute: re-running any completed run's spec snapshot and seed produces output identical to the original in 100% of attempts, including runs executed in parallel.
- **SC-002**: A first-time user can go from a plain-English scenario description to a downloaded, labeled dataset in under 15 minutes, without editing any file on disk.
- **SC-003**: A new installation reaches a running, usable studio from the single documented command in under 10 minutes on a machine meeting documented prerequisites.
- **SC-004**: 100% of generated events are traceable to their originating actor; 100% of fraudulent events carry their typology and fraud-actor identity; 100% of corrupted deliveries are enumerated in the answer key with their corruption type; 0 ground-truth fields appear in a main export unless the user explicitly acknowledged the warning.
- **SC-005**: For runs at the reference scale (≥100,000 transactions), the achieved fraud rate lands within 10% relative of the configured target, and the realism report states both numbers.
- **SC-006**: The reference scenario — 200,000 consumers, 5,000 merchants, 90 simulated days — completes generation successfully, and its history-to-live continuation proceeds with zero world-state discontinuity (no actor resets, no re-seeded population).
- **SC-007**: In live streaming, delivered throughput stays within 5% of the configured target rate under normal sink conditions over a sustained one-hour window, with memory usage flat (no growth trend) for the duration; the published benchmark demonstrates a sustained 1,000 events per second to the streaming sink.
- **SC-008**: 100% of semantic-invariant violations in a spec are surfaced at edit/validation time with a located, human-readable explanation; 0 runs start from a spec that fails validation.
- **SC-009**: At least 90% of scenario descriptions comparable in scope to the template gallery compile to a valid spec (directly or via the repair loop) without hand-editing.
- **SC-010**: Every product capability is reachable through the web UI; a user who never opens a terminal after installation can operate 100% of features.
- **SC-011**: An interrupted run resumed after failure completes with a truth record containing zero duplicated and zero missing events relative to an uninterrupted run of the same spec and seed.

## Scope Boundaries *(v1)*

**In scope (irreducible v1)**: scenario workspace, run control, and world inspector in the UI, with the streaming sink, labeled fraud (three typologies), the imperfection engine (four types), and the realism report underneath; plus the remaining stories above in priority order.

**Documented de-scope order if delivery compresses** (cut from the end first): run comparison and template gallery first; ground-truth actor stories second (labels remain exportable via files); webhook sink third.

**Explicitly out of scope for v1** (announced roadmap, not built now):

- Multi-perspective reconciliation outputs — the same truth emitted as issuer, acquirer, and switch extracts plus end-of-day settlement files with configurable injected breaks (v1.1 headline).
- A programmatic agent-integration server exposing compile/generate/fetch as tools for coding agents (v1.1).
- AML typologies — structuring/smurfing, mule networks — with graph-shaped ground truth and graph exports (v1.2).
- Concept-drift scheduling (fraud tactics evolving mid-run), payment-format packs (ISO 8583, ISO 20022, UPI-like, generic), label-noise injection, and a community scenario-pack registry (v2 candidates).
- Publishing flagship datasets to public data platforms (distribution activity, not product functionality).

## Assumptions

- **Deployment trust boundary**: v1 is self-hosted for a single team inside a trusted network; there is no login — anyone who can reach the studio has full access. Per-user accounts, roles, and multi-tenancy are explicitly not v1 requirements. Stored secrets (sink credentials, language-model API keys) must nevertheless be encrypted at rest.
- **Language-model provider**: the user supplies and configures their own provider and credentials in the settings surface; v1 supports Anthropic plus any OpenAI-compatible endpoint (covering hosted and local models). Natural-language features are optional and degrade gracefully when absent (FR-012).
- **Natural-language input**: English-language scenario descriptions are the v1 target.
- **Reference calibration**: realism defaults for the flagship India/UPI-style template are calibrated against published public aggregates (e.g., national payment-system statistics), with sources documented; other templates use documented, overridable defaults.
- **Scale envelope**: the documented v1 envelope centers on the reference scenario (200k consumers / 5k merchants / 90 days), with live streaming benchmarked at a sustained 1,000 events per second; larger scales are best-effort and bounded by the published benchmark.
- **Simulated instrument scope**: v1 models consumer-to-merchant payments, peer-to-peer transfers (as used by drain behavior), salary/income credits, and refunds within a single simulated payment network per scenario, denominated in a single per-scenario currency (multi-currency worlds and FX are out of scope for v1).
- **License**: Apache-2.0, matching fintech open-source norms and permitting corporate adoption.
- **Competitive positioning** (informs messaging, not requirements): leads with the world model, ground truth, and answer key — not "generate data from English"; a comparison against adjacent tools is documented plainly in the project README.
