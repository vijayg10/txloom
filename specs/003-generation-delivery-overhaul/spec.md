# Feature Specification: Generation-to-Delivery Overhaul

**Feature Branch**: `003-generation-delivery-overhaul`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Refer the file docs/architecture-review.md" (since removed) — the architecture review of the path from scenario creation to synthetic events landing in a sink (files, Kafka, RabbitMQ, webhook), its gaps (G1–G16, U1–U3, Kafka configuration), and its proposed changes (P0–P4, UI-1–UI-3, CONN-1–CONN-5).

## Context

The review found that several v1 headline promises are not yet delivered to users:

- **Labeled imperfections** never reach any data a user receives, and the answer key lists corruptions that are not in the data (G1).
- **History-to-live continuity** is only partial. Live streams have no fraud, income or seasonality, and their timestamps don't continue from history (G2).
- **Authenticated brokers can't be reached.** Stored connections never publish, and launch options such as sink selection and "history then stream" have no effect (G3).
- **The reference scale fails.** Runs at 200k consumers, 5k merchants, 90 days and 1,000 events/s run into quadratic generation, unbounded memory, no parallelism, and stream starts that re-run history (G4–G7).
- **Getting events onto a Kafka topic takes seven screens** across three sections, and broker addresses are configured in four places that don't know about each other (U1–U2, §4).

This feature closes those gaps. It fixes generation and delivery so outputs match the answer key at reference scale. It replaces inline broker addresses with saved connections bound at launch, and it restructures the UI around the question users start with: *where should the events go?*

## Clarifications

### Session 2026-10-10

- Q: Should the history phase also be published to the bound broker or webhook, or go only to files? → A: It is a per-launch choice, "Replay history to broker", under Advanced and off by default. When on, the history is replayed to the destination before live starts. When off, brokers and webhooks receive only the live phase.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stream to my own authenticated Kafka cluster (Priority: P1)

A fraud-platform engineer has a staging Kafka cluster that needs SASL/SCRAM over TLS and a private CA. They register it once as a named connection: they fill in a typed form, test it before saving, and then pick it when launching a run. Events from the run arrive on their topic. They never type the broker address again, and the credentials are never shown again after saving.

**Why this priority**: Today no authenticated cluster can be reached at all. This is the most common real deployment target, and it blocks every other broker-facing improvement.

**Independent Test**: Register a connection to a SASL_SSL + SCRAM-SHA-512 cluster with a CA certificate, test it, save it, launch a run bound to it, and consume the events from the chosen topic.

**Acceptance Scenarios**:

1. **Given** no saved connections, **When** the user adds a Kafka connection and chooses SASL_SSL, **Then** the form shows SASL mechanism, username/password and CA-certificate fields, and hides fields that don't apply to the chosen security protocol.
2. **Given** a filled-in but unsaved connection form, **When** the user runs Test, **Then** the result reports whether the cluster is reachable, whether authentication succeeded, whether the default topic exists or would be auto-created, and its partition count. Nothing is stored until the user saves.
3. **Given** a test that fails, **When** the result is shown, **Then** it names the failing stage (unreachable, TLS, authentication, topic) and what to check.
4. **Given** a saved connection, **When** the user views or edits it later, **Then** the password is never displayed. It can only be replaced.
5. **Given** a scenario whose spec declares a logical Kafka sink named `events`, **When** the user launches a run and chooses the saved connection as the destination for `events` with topic `upi.events`, **Then** events are published to that topic using the stored credentials.
6. **Given** a broker address containing `localhost`, **When** the user enters it, **Then** a warning explains that the address must be reachable from the TxLoom worker, and gives the in-network address of the bundled demo broker as the example.

---

### User Story 2 - Delivered data matches the answer key (Priority: P1)

A data scientist configures duplicate, late, out-of-order and clock-skew imperfections on a sink. They then test their deduplication and reconciliation logic against the output. Every corruption the answer key lists is actually present in what they received, whether that is a file, a broker topic or a webhook. Nothing the answer key calls delivered was silently dropped.

**Why this priority**: The labeled imperfection engine is a listed differentiator, and it currently affects no output at all. Worse, the answer key misleads users about the data they hold.

**Independent Test**: Run a scenario with all four imperfection types targeting one file sink and one Kafka sink, with "Replay history to broker" on. For each sink, reconcile the delivered records against the answer key's corruption labels.

**Acceptance Scenarios**:

1. **Given** a spec with imperfections targeting a file sink, **When** the user exports that sink's output, **Then** the export contains the corrupted delivered copies (duplicates, late, reordered, skewed). The truth record stays separately available and uncorrupted.
2. **Given** a spec with imperfections targeting a broker sink, and a run launched with "Replay history to broker" on, **When** the history is replayed to the bound connection, **Then** the broker receives the corrupted delivered copies, and the answer key labels exactly those corruptions.
3. **Given** an imperfection targeting sink A only, **When** sink B's output is inspected, **Then** sink B contains no corruption from that imperfection.
4. **Given** a delivery that fails permanently (for example a webhook endpoint returning errors past its retry limit), **When** the run or stream records the outcome, **Then** the event is counted as failed in the metrics and labeled `dropped` in the answer key. It is never labeled as a normally delivered event.
5. **Given** a live stream with imperfections configured, **When** events are streamed, **Then** live events carry the same imperfection types, and the label channel records each one.

---

### User Story 3 - Runs and streams work reliably at reference scale (Priority: P1)

An engineer launches the documented reference scenario (200k consumers, 5k merchants, 90 days, all fraud typologies and imperfections), then streams it at 1,000 events/s. Generation finishes in bounded time and memory, using all available worker capacity. The stream starts quickly, without regenerating history. Stopping and restarting a stream, running two streams at once, and retrying a failed run all behave as the UI says they do.

**Why this priority**: The reference scale is the v1 definition of done, and today it plausibly takes hours per partition and several GB per thread. Silent failures such as a "streaming" status with nothing published undermine trust in every other feature.

**Independent Test**: Run the reference-scale benchmark end to end and check the time and memory budgets. Separately: stop and restart a stream; run two streams at once; run a tiny scenario; force a partition failure and retry it.

**Acceptance Scenarios**:

1. **Given** the reference scenario, **When** it is generated, **Then** partitions run in parallel up to the configured worker capacity, and peak memory per partition does not grow with history length.
2. **Given** a completed run, **When** the user starts its stream, **Then** live events begin flowing without the full history being generated again, and other runs and streams on the same deployment keep making progress.
3. **Given** a stream that was stopped, **When** the user starts it again, **Then** events are published again. A status of "streaming" always means events are being published.
4. **Given** a paused stream, **When** a client asks to start it, possibly with a different destination, **Then** the request is rejected with a message telling the user to resume the stream, or to stop it before changing the destination.
5. **Given** two completed runs, **When** both streams are started, **Then** both publish at once, and neither waits for the other to stop.
6. **Given** a very small run, **When** it finishes faster than its launch bookkeeping, **Then** it still reaches `completed`.
7. **Given** a transient failure in one partition, **When** it occurs, **Then** that partition is retried automatically, with increasing delay, up to a limit. If the limit is exhausted the run is marked failed, and the user can retry it.
8. **Given** a spec version that has become invalid because a validation rule got stricter, **When** the user rolls back to it, clones a template that produces it, or launches it, **Then** validation runs again and explained errors block the action.

---

### User Story 4 - Regenerate exactly the same dataset, or be told why not (Priority: P1)

A researcher regenerates a run from months ago to reproduce a published result. If the engine hasn't changed in an output-affecting way, they get a byte-identical dataset. If it has, they are told plainly, before anything is generated, which engine version produced the original and that the output will differ.

**Why this priority**: Reproducibility is non-negotiable under the project constitution, and several fixes in this feature change generated output. Versioning has to be in place before those fixes ship.

**Independent Test**: Generate a run, regenerate it on the same engine version and compare bytes. Then simulate an engine-version change and confirm the warning or refusal. Also confirm that two seeds differing only above 32 bits produce different outputs, or that the out-of-range seed is rejected.

**Acceptance Scenarios**:

1. **Given** a completed run, **When** it is regenerated on the same engine version, **Then** the output is byte-identical. The same partition count is used even if the default partitioning rule has changed.
2. **Given** a run produced by an older engine version, **When** the user regenerates or streams it, **Then** a message names both versions and states that the output will differ. The user must confirm to continue, or the action is refused if the old version can't be honoured.
3. **Given** a seed given as a large integer, **When** it is submitted through any client, **Then** it is stored exactly, with no precision loss.
4. **Given** two different accepted seeds, **When** both are run with the same spec, **Then** the outputs differ. Seeds outside the supported range are rejected with an error that states the range.

---

### User Story 5 - Launch from the scenario page in one place (Priority: P2)

A user on a scenario's page opens a Launch panel that asks three questions, each with a sensible default: where each sink in the spec should go, what to send (history only, or history then a live stream), and at what rate. It shows an estimate of history volume and duration. Advanced options (seed, label channel, scale override) are collapsed. On repeat launches the last destinations are remembered, so launching takes one click. If the right connection doesn't exist yet, the user creates it from inside the panel without losing anything they have already entered.

**Why this priority**: This collapses the seven-screen journey into one panel. It depends on User Story 1's connections and destinations.

**Independent Test**: Starting from a cloned template, launch a history-then-live run to Kafka from the scenario page. Check that the stream starts automatically when history completes, without a visit to any other section.

**Acceptance Scenarios**:

1. **Given** a scenario whose spec has a Kafka sink and a file sink, **When** the Launch panel opens, **Then** each logical sink is listed with a destination selector. The Kafka sink offers saved connections plus "New connection…", with a topic pre-filled from the connection's default and editable for this run. The file sink offers a file download.
2. **Given** the user picks a Kafka destination, **When** the mode is shown, **Then** "History, then live stream" is pre-selected.
3. **Given** "History, then live stream", **When** history generation completes, **Then** the live stream starts automatically with the run's destinations and target rate.
4. **Given** a broker sink with no destination chosen, **When** the user tries to launch, **Then** launch is blocked, and a message names the unbound sink.
5. **Given** the user chooses "New connection…" mid-launch, **When** they save the new connection, **Then** it becomes the selected destination, and every other field in the panel keeps its value.
6. **Given** a scenario launched before, **When** the panel reopens, **Then** the previous destinations and topics for that scenario are pre-selected.
7. **Given** any spec, **When** the panel opens, **Then** it shows an estimated history event count and generation duration, computed without running generation.
8. **Given** a broker destination, **When** the user opens Advanced, **Then** "Replay history to broker" is shown, off by default. Turning it on adds the estimated replay volume to the estimate line.
9. **Given** "Replay history to broker" is on and the mode is "History, then live stream", **When** history generation completes, **Then** the run shows a replay phase with its own progress, and the live stream starts only when the replay finishes.
10. **Given** "Replay history to broker" is off, **When** the run completes, **Then** nothing from the history phase is published to broker or webhook destinations.
8. **Given** the agent-integration server or the command line, **When** an agent or script lists connections and launches a run or stream, **Then** it uses the same named connections and destinations as the UI, and no client can pass broker addresses or credentials inline.

---

### User Story 6 - The live stream is the same world, continued (Priority: P2)

A fraud-detection team scores a model in real time against a live stream that follows a 90-day history. Live events continue on the simulated timeline from the exact moment history ended. They keep the same daily and weekly rhythm, seasonality, income credits and fraud campaigns as the history, so the live label channel contains real fraud to detect.

**Why this priority**: History-to-live continuity is a listed differentiator, and today's all-legitimate, uniformly random live stream can't be used to test fraud detection. It depends on the unified per-day generation pipeline.

**Independent Test**: Stream from a completed run with fraud typologies configured. Check that live timestamps start at the end of the history window, that the live mix includes income credits and fraudulent events, and that weekday/weekend volume ratios match the history's within tolerance.

**Acceptance Scenarios**:

1. **Given** a history window ending at simulated time T, **When** live streaming starts, **Then** the first live event's simulated timestamp is at or after T. There is no gap beyond normal inter-arrival spacing, and no overlap with history.
2. **Given** a spec with fraud typologies, **When** the stream runs long enough to cover typical campaign spacing, **Then** live events include fraud campaigns, labeled with typology and actor.
3. **Given** a spec with income schedules and seasonality, **When** live events are sampled, **Then** income credits appear, and volume follows the same weekly and seasonal shape as history.
4. **Given** a delivered live event, **When** it is inspected, **Then** its event timestamp is simulated time. The time it was actually delivered is recorded separately.
5. **Given** a stream being paused, resumed or re-rated, **When** it continues, **Then** simulated time and world state continue without reset.

---

### User Story 7 - Honest stream health under load and failure (Priority: P2)

An operator watches a stream's rate dial, sink lag and backpressure indicators while the downstream system slows down or an endpoint misbehaves. The indicators reflect reality. The stream slows when the sink pushes back. One slow webhook endpoint doesn't freeze the stream. RabbitMQ deliveries count as delivered only after the broker confirms them.

**Why this priority**: The stream console's indicators are a v1 surface, and today they're hard-coded or never triggered. Throughput is also capped by one-at-a-time publishing.

**Independent Test**: Stream to a throttled Kafka topic, a webhook endpoint that hangs, and a RabbitMQ broker that blocks publishing. In each case, check that lag and backpressure indicators respond, the achieved rate adapts, and no undelivered event is reported as delivered.

**Acceptance Scenarios**:

1. **Given** a sink that is slower than the target rate, **When** the stream runs, **Then** backpressure shows as active, sink lag shows the real number of events in flight and queued, and the achieved rate falls rather than queuing without bound.
2. **Given** a webhook endpoint that stops responding, **When** requests to it time out, **Then** they are retried without blocking delivery of other events, and they are labeled `dropped` once retries are exhausted.
3. **Given** a RabbitMQ destination, **When** an event is counted as delivered, **Then** the broker has confirmed receiving it.
4. **Given** a sink with healthy round-trip times, **When** the stream targets 1,000 events/s, **Then** the target is reached without being capped by per-event round-trip latency.

---

### User Story 8 - One run page, clear navigation, and a two-click first run (Priority: P3)

A first-time user on an empty install sees one card: "Stream a sample UPI world to Kafka". Two clicks later, events are on a topic of the bundled local broker, which TxLoom has already registered as a connection. From then on, each run has a single page with tabs for Progress, Live stream, Inspect, Ground truth and Export. Runs are listed by scenario name, version and start time. The sidebar has three sections: Scenarios, Runs and Connections.

**Why this priority**: This polishes navigation and onboarding on top of User Stories 1 and 5. It is valuable, but the product works without it.

**Independent Test**: On a fresh install with the demo broker running, click the first-run card and confirm events on the topic. Then open the run and move through every tab without picking the run again.

**Acceptance Scenarios**:

1. **Given** an empty install with the bundled demo broker running, **When** the system starts, **Then** a `local-kafka` connection pointing at the demo broker's in-network address, with a default topic, is available without any configuration editing.
2. **Given** the demo broker is running but `local-kafka` has been deleted, **When** the user views Connections or the Launch panel's destination list, **Then** a prompt offers to add the detected local broker.
3. **Given** an empty install, **When** the user clicks the first-run card and confirms, **Then** the UPI template is cloned, bound to `local-kafka`, and launched as history then live.
4. **Given** a run, **When** the user opens it, **Then** Progress, Live stream, Inspect, Ground truth and Export are tabs of that run. The page moves to Live stream by itself when streaming starts.
5. **Given** the Live stream tab, **When** it is shown, **Then** the destination appears read-only as `connection / topic`, and **Change** is enabled only while the stream is stopped.
6. **Given** a bookmarked address from the old navigation (stream console, inspector, ground truth), **When** it is opened, **Then** it redirects to the matching tab of the run page.
7. **Given** a template was just cloned, **When** the scenario page opens, **Then** it shows that version 1 is already saved.
8. **Given** any in-app link, **When** it is followed, **Then** the view changes without reloading the whole application.

---

### User Story 9 - More believable fraud and timing, and exports that keep every label (Priority: P3)

A data scientist reviewing generated data sees account-takeover campaigns that start at staggered times, with genuinely dormant victims beforehand, and daily activity that follows a realistic time-of-day curve. When they export events with labels merged in, every label field (fraud flag, typology, actor, campaign step) is kept, even for very large runs.

**Why this priority**: These are realism and scale refinements. They improve data quality but don't block the core flow.

**Independent Test**: Generate a run with account takeover enabled. Check the spread of campaign start times, the absence of normal victim activity during dormancy, and the hour-of-day histogram. Export a reference-scale run with labels and check its fields and memory use.

**Acceptance Scenarios**:

1. **Given** multiple account-takeover campaigns, **When** their start times are compared, **Then** they are spread across the history window, not all at one instant.
2. **Given** a victim in a dormancy period, **When** their events are inspected, **Then** no normal spending occurs during that period.
3. **Given** a day of legitimate activity, **When** events are grouped by hour, **Then** volume follows a daily activity curve, not a flat distribution.
4. **Given** an export with labels included, **When** it completes, **Then** every row carries fraud flag, typology, actor and campaign step, and the export's memory use does not grow with the number of labels.

---

### Edge Cases

- **A connection is deleted or edited while runs reference it.** Completed run records keep the destination name and topic as they were at launch. Starting a stream for such a run requires a valid connection, and a deleted connection triggers a prompt to choose a new destination. Edits apply only to future stream starts.
- **A spec's logical sink is renamed between versions.** Remembered destinations for the old name aren't applied. The panel shows the renamed sink as unbound.
- **A connection test succeeds but the topic doesn't exist and the cluster forbids auto-creation.** The test reports this as a failure, with the topic named, and saving is still allowed (the topic may be created later), with a warning.
- **The engine version changed while a run was mid-generation or a stream was paused.** Remaining partitions and resumed streams use the run's recorded engine version, or are refused with an explanation. Engine versions are never mixed silently inside one run.
- **The worker restarts mid-stream.** The stream resumes from its saved world state without duplicate publishing beyond what at-least-once delivery inherently allows. Any such duplicates are not labeled as injected imperfections.
- **Too many deliveries fail.** Failed deliveries can grow without bound, for example when a webhook is down for hours. The stream surfaces a persistent error state and the failure count, and lets the operator stop it. It does not retry forever.
- **A history-then-live run's history fails.** The live stream does not start, and the run shows why.
- **A history replay to a broker fails partway.** Events already published stay published. Failed events are labeled `dropped` (FR-023). The live stream does not start until the user either retries the remaining replay or skips it, and the run shows how much was replayed.
- **The topic's retention is shorter than the history window.** A history replay is still published. The connection test result, or the Launch panel, warns when the topic's retention is known to be shorter than the replayed span.
- **A "local" broker address works from the host but not from inside the deployment.** The connection test runs from where publishing happens, so it reports the real result.
- **The target rate is above what the sink can sustain.** The achieved rate settles at the sink's limit, and the gap between achieved and target is visible. Events are not dropped silently.

## Requirements *(mandatory)*

### Functional Requirements

#### Reproducibility and engine versioning

- **FR-001**: Every run MUST record the engine version that generated it and the partition count it used, at launch.
- **FR-002**: Regenerate, resume and stream start MUST use the run's recorded partition count, never a recalculated one.
- **FR-003**: When the running engine version differs from a run's recorded version, regenerate and stream start MUST either refuse or require explicit confirmation, after a message that names both versions and states that output will differ.
- **FR-004**: The system MUST guarantee that the same spec, seed and engine version produce byte-identical output.
- **FR-005**: Seeds MUST be accepted and stored exactly, without precision loss, from every client. Two distinct accepted seeds MUST NOT produce identical output, and seeds outside the supported range MUST be rejected with an error that states the range. When a launch supplies no seed, the spec's own seed MUST be used, and a seed written inside a spec MUST be limited to the range a spec document represents exactly.
- **FR-006**: Any change in this feature that alters what a given spec and seed produce MUST ship under a new engine version, and MUST NOT ship before FR-001–FR-003. This includes at least FR-005, FR-034–FR-036 and FR-041–FR-044.

#### Connections

- **FR-007**: Users MUST be able to create, view, edit, test and delete named connections of type Kafka, RabbitMQ and webhook, using typed forms that show only the fields relevant to the chosen options. No raw-configuration text box is offered.
- **FR-008**: Kafka connections MUST support these security protocols: PLAINTEXT, SSL, SASL_PLAINTEXT and SASL_SSL. They MUST support these SASL mechanisms: PLAIN, SCRAM-SHA-256 and SCRAM-SHA-512. They MUST accept an optional CA certificate and a default topic.
- **FR-009**: Credentials MUST be stored encrypted, MUST NOT be displayed after saving, and MUST NOT appear in run records, logs, exports or responses to any client.
- **FR-010**: Users MUST be able to test a connection before saving it. For Kafka, the test MUST report reachability, the TLS/authentication outcome, whether the default topic exists or would be auto-created, and the topic's partition count. Tests MUST run from where publishing happens.
- **FR-011**: Each saved connection MUST show a health indicator with the time and result of its last test.
- **FR-012**: When a broker address refers to the local host, the form MUST warn that the address must be reachable from the TxLoom worker, and MUST give the demo broker's in-network address as an example.
- **FR-013**: When the bundled demo broker is running, the system MUST register a `local-kafka` connection to it on startup if none exists. If it was removed, the Connections page and the Launch panel's destination list MUST offer to add the detected broker.
- **FR-014**: Operators MAY pre-register connections through deployment environment settings, for headless and CI setups. First-use setup MUST still need no configuration editing.

#### Destinations (sink destinations)

- **FR-015**: Specs MUST keep declaring logical sinks (type and name) with no addresses or credentials. Imperfections MUST keep targeting logical sink names.
- **FR-016**: Run launch and stream start MUST take a destination for each broker or webhook sink in the spec: a connection and, for topic-based brokers, a topic that defaults to the connection's default topic. Launch MUST be blocked, with the unbound sink named, while any such sink lacks a destination.
- **FR-017**: A run MUST record its destinations (connection name and identity, topic) without secrets, so the run stays auditable. This launch-time record MUST NOT change afterwards; later changes of destination (FR-048) apply only to future stream sessions, and each session and history replay records the destination it actually used.
- **FR-018**: The UI, command line and agent-integration server MUST all use named connections and destinations. Inline broker addresses or credentials MUST be removed from every client and from the service interface. The agent-integration server MUST offer a way to list connections.
- **FR-019**: The system MUST remember each scenario's last destinations and pre-select them on its next launch.

#### Delivery

- **FR-020**: Every sink's output MUST be the delivered copy with that sink's configured imperfections applied. This covers file exports, broker sinks and webhook sinks. Truth records MUST stay uncorrupted and separately exportable.
- **FR-021**: The history phase MUST be written to files. It MUST be published to a run's broker and webhook destinations only when the user turns on "Replay history to broker" at launch. That option sits under Advanced and is off by default. When it is on:
  - the history's delivered copies, imperfections included, MUST be published before the live phase begins, as fast as the destination accepts them;
  - progress MUST be shown as its own phase of the run;
  - live streaming, if selected, MUST start only after the replay completes.

  When it is off, broker and webhook destinations receive only the live phase. The chosen setting MUST be recorded on the run.
- **FR-022**: Launch MUST offer two modes, "history only" and "history, then live stream". In "history, then live stream" mode, the live stream MUST start automatically when history completes, using the run's destinations and target rate. Choosing a Kafka destination MUST pre-select this mode.
- **FR-023**: A delivery that fails permanently MUST be counted in the stream or run metrics, and MUST be labeled `dropped` in the answer key. It MUST NOT be labeled or counted as delivered.
- **FR-024**: An event MUST be counted as delivered only once the destination has acknowledged it. For RabbitMQ that means the broker has confirmed it.
- **FR-025**: Exports with labels included MUST keep every label field (fraud flag, typology, actor, campaign step, corruption type). Their memory use MUST NOT grow with the number of events or labels.

#### Stream control and health

- **FR-026**: Starting a stream that was previously stopped MUST publish events. A "streaming" status MUST mean events are being published.
- **FR-027**: Starting a stream that is paused MUST be rejected, with a message telling the user to resume it, or to stop it first to change the destination.
- **FR-028**: Starting a stream MUST NOT regenerate the run's history. Each partition's end-of-history world state MUST be saved when that partition finishes generating, and loaded at stream start.
- **FR-029**: Multiple streams MUST be able to run at the same time, and no stream may delay generation work or other streams.
- **FR-030**: Publishing MUST allow a bounded number of sends in flight. Backpressure reported by a sink MUST reduce the achieved rate. Sink lag MUST show real in-flight plus queued events.
- **FR-031**: Webhook requests MUST time out. Retries MUST NOT block delivery of other events.
- **FR-032**: When more than 50% of a stream's delivery attempts fail over a rolling 30-second window (with at least 100 attempts in that window), the stream MUST enter a visible error state, show the failure count, and stop retrying without limit.

#### Generation reliability and scale

- **FR-033**: A worker MUST generate multiple partitions in parallel, up to its configured capacity.
- **FR-034**: Generation MUST proceed one simulated day at a time, writing each day's output before the next day starts, so that per-partition memory does not grow with history length.
- **FR-035**: Generating refund-abuse fraud MUST take time roughly proportional to the number of events. It MUST NOT re-scan the partition for each attempt.
- **FR-036**: Run setup work at launch, resume and stream start MUST NOT make the service unresponsive to other requests. Large shared data such as the merchant pool MUST NOT be copied into every unit of work.
- **FR-037**: A run MUST reach its correct final status however quickly its partitions finish.
- **FR-038**: Failed partitions MUST be retried automatically, with increasing delay, up to a configured limit. Users MUST be able to retry a failed run.
- **FR-039**: The spec MUST be validated again at rollback, at template clone and at launch. Validation failures MUST block the action and explain why.
- **FR-040**: A reference-scale batch benchmark MUST be published and reproducible. It MUST use 200k consumers, 5k merchants, 90 days, and all typologies and imperfections, and it MUST run through the same job path users use.

#### Live continuity and realism

- **FR-041**: Live events MUST be produced by the same behaviour model as history: income credits, spending rhythm, weekend and seasonal effects, and fraud campaigns, with labels.
- **FR-042**: Live mode MUST run a simulated clock that continues from the end of the history window. Event timestamps MUST be simulated time, and delivery time MUST be recorded separately. The target rate MUST control how fast simulated time advances relative to wall-clock time.
- **FR-043**: Fraud campaigns MUST be planned before generation. Account-takeover start times MUST be spread across the window, and victims MUST show no normal activity during dormancy. Legitimate activity MUST follow a daily activity curve.
- **FR-044**: Imperfections MUST be applied per event, in both history delivery and live streaming, and every live imperfection MUST be labeled on the label channel.

#### User interface

- **FR-045**: The scenario page MUST offer a Launch panel with these sections: per-sink destinations, the send mode, the target rate, a collapsed Advanced section (seed, label channel, scale override, and "Replay history to broker"), and an estimate of history event count and duration that is computed without generation. The panel replaces the separate launch page and the stream console's inline launcher.
- **FR-046**: From the Launch panel's destination list, users MUST be able to create a new connection with the same form as the Connections page. Saving it MUST select it and keep every other entered value.
- **FR-047**: Each run MUST have one page with tabs for Progress, Live stream, Inspect, Ground truth and Export. The page MUST switch to Live stream by itself when streaming starts. Inspect, Ground truth and Live stream MUST NOT have their own run pickers.
- **FR-048**: The Live stream tab MUST show the destination read-only. Changing it MUST be possible only while the stream is stopped.
- **FR-049**: Primary navigation MUST be Scenarios, Runs and Connections. Addresses from the previous navigation MUST redirect to their new equivalents.
- **FR-050**: Runs MUST be identified everywhere by scenario name, version and start time, with the run identifier shown as secondary information.
- **FR-051**: In-app navigation MUST NOT reload the whole application.
- **FR-052**: On an empty install, the home page MUST offer a first-run action that clones the UPI template, sets `local-kafka` as its destination, and launches it as history then live.
- **FR-053**: After a template clone, the scenario page MUST show that version 1 is saved.

### Key Entities

- **Connection**: A named, shared destination endpoint of type Kafka, RabbitMQ or webhook. It holds the address, security settings, encrypted credentials, an optional CA certificate, a default topic (Kafka) or equivalent routing default, and the result and time of its last health test. It is independent of any scenario.
- **Logical sink**: Declared in a spec as a type plus a name. It describes what kind of output a scenario produces, and it is what imperfections target. It never contains addresses or secrets.
- **Destination**: Links one logical sink of a run to one connection, plus an optional topic override. It is chosen at launch, stored on the run without secrets, and remembered per scenario as the default for the next launch.
- **Run**: Gains an engine version, a partition count, its destinations, its send mode and its history-replay setting, on top of its existing spec snapshot, seed and outputs.
- **World checkpoint**: The end-of-history state saved for each partition (random-number state and actor states). Live streaming resumes from it.
- **Stream session**: One start of a run's stream, distinct from earlier starts of the same run. It carries its destinations, target rate, status, and counts of delivered, failed and dropped events.
- **Answer-key label**: Gains a delivery outcome, `dropped`, for events that were generated but couldn't be delivered. It is kept separate from the corruption type, which still lists exactly the four injectable imperfections.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user on a fresh install with the demo broker running gets synthetic events onto a Kafka topic in 2 clicks from the home page. Today it takes 7 screens.
- **SC-002**: A returning user launches a previously launched scenario to the same destinations in 1 click from the scenario page.
- **SC-003**: A user registers an authenticated (SASL_SSL with SCRAM) Kafka connection and gets a pass or fail test result in under 3 minutes, without consulting documentation outside the form.
- **SC-004**: For every sink with imperfections configured, 100% of corruptions labeled in the answer key are present in that sink's delivered output, and 0 events labeled as delivered are missing from it.
- **SC-005**: Regenerating any run on the same engine version produces byte-identical output in 100% of trials. Every regeneration across engine versions shows the version-mismatch message before generating.
- **SC-006**: The reference scenario (200k consumers, 5k merchants, 90 days, all typologies and imperfections) completes batch generation in under 30 minutes on the documented reference hardware.
- **SC-007**: Peak memory per partition being generated stays under 1 GB, and grows by no more than 10% between a 30-day and a 90-day history of the same population.
- **SC-008**: Doubling the population of a single partition with refund abuse enabled increases its generation time by no more than 2.5×. Today it increases by 4.5×.
- **SC-009**: At reference scale, live events begin flowing within 30 seconds of a stream start.
- **SC-009a**: With "Replay history to broker" on, 100% of the history's delivered copies for each broker sink, imperfections included, appear on the destination before the first live event.
- **SC-010**: Streaming to Kafka at a 1,000 events/s target for 30 minutes keeps achieved throughput within 5% of target in at least 99% of one-second windows, with flat memory.
- **SC-011**: 100% of stream restarts after a stop result in events being published. Two streams started at once both publish within 30 seconds of starting.
- **SC-012**: Live streams from a spec with fraud typologies contain labeled fraud events. Their weekday/weekend volume ratio is within 10% of the history's.
- **SC-013**: One unresponsive webhook endpoint does not drop the stream's achieved rate to zero for other events. Retries are bounded, and exhausted retries show up as `dropped` labels.
- **SC-014**: Starting a run, resuming a run or starting a stream never makes the service unresponsive to other requests for more than 100 ms.

## Assumptions

- **Scope.** This spec covers every proposed change in the architecture review (P0–P4, UI-1–UI-3, CONN-1–CONN-5). Delivery is sequenced by the review's suggested order: versioning and non-output-changing fixes first, then connections and destinations, then UI, then output-changing fixes, then the unified pipeline, with stream hardening in parallel. The planning phase may split it into multiple increments.
- **UI prototype.** The clickable, mocked-data UI prototype recommended as the review's next step is a design activity that comes before implementing User Stories 5 and 8. It is not specified separately here, and its findings may revise the UI requirements.
- **Navigation and FR-036.** The six UI surfaces required by the v1 spec (FR-036) are all kept. The stream console, world inspector and ground-truth explorer become tabs of a run, and "connections & settings" becomes the Connections page plus settings. This changes navigation, not which capabilities exist.
- **Live time pacing.** Simulated time in live mode advances at whatever pace the target rate implies, so the rate is the only control. There is no separate "simulation speed" setting.
- **Failed deliveries.** These are recorded as `dropped` labels and counted in metrics. A separate dead-letter file is not required in this feature.
- **Balance model.** A model of account balances, so that drains and refunds are limited by funds, is out of scope and deferred to a later realism release.
- **Reference hardware.** The machine for SC-006 and SC-010 is defined, and published, in the plan's benchmark section.
- **Breaking change.** Removing inline sink configuration from the stream-start interface and the agent tool is accepted. Callers move to named connections.
- **Test suite.** The existing end-to-end suite (specs/002) will be updated for the new navigation and destination model. Redirects from old addresses limit the breakage.
- **Paused streams.** Starting a paused stream with a new destination is rejected, not treated as a silent replacement, because explicit failure is safer than a hidden change of destination.
