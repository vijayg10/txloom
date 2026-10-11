# Screenshots

All screenshots show the UPI reference scenario: 5,000 consumers, 400 merchants, 90 days of history, then a live stream to Kafka at 50 events per second.

## First Run

On an empty install with the demo Kafka broker, one button clones the reference scenario and launches it.

![First-run card](./assets/01-first-run.png)

---

## Scenarios and Template Gallery

Your scenarios, a form for a blank scenario, and the four templates.

![Scenarios and template gallery](./assets/02-scenarios.png)

---

## Scenario Workspace

The spec editor with schema autocomplete and live validation.

![Scenario workspace — spec editor](./assets/03-scenario-workspace.png)

Below the editor: the structural preview (population, fraud mix, imperfections, estimated volume) and the version history with compare and rollback.

![Scenario workspace — preview and version history](./assets/03a-scenario-preview-versions.png)

---

## Launch Drawer

Bind each sink to a connection, choose the mode and rate, and see the estimate before launching.

![Launch drawer](./assets/03b-launch-drawer.png)

---

## Runs

Every run, named by scenario, spec version and start time.

![Run list](./assets/04a-runs.png)

---

## Run Progress

Partition progress, run controls, and the immutable run record with **Regenerate exactly this dataset**.

![Run progress](./assets/04-run-progress.png)

---

## Live Stream

Achieved throughput against the target, sink lag, paced rate, failed deliveries, simulated time, backpressure, and a ticker of sampled events.

![Live stream console](./assets/05-live-stream.png)

---

## World Inspector

Volume over time, with the Diwali seasonality window shaded.

![World inspector — volume over time](./assets/06-world-inspector.png)

Amount distributions per event type and the day-of-week by hour-of-day activity heatmap.

![World inspector — amounts and heatmap](./assets/07a-inspector-amounts-heatmap.png)

Fraud events per day by typology, and the imperfection audit per sink.

![World inspector — fraud timeline and imperfection audit](./assets/07b-inspector-fraud-timeline.png)

---

## Realism Report

Event count, amount statistics, inter-arrival time, achieved fraud rate with counts per typology, and the template's benchmark reference.

![Realism report](./assets/07c-inspector-realism-report.png)

---

## Ground Truth

Labeled events filtered to the account-takeover typology.

![Ground-truth explorer](./assets/08-ground-truth.png)

---

## Actor Story

One actor's campaign, step by step: four draining transfers from the same victim.

![Actor story](./assets/09-actor-story.png)

---

## Export

Choose the source and format. Labels are excluded unless you include them.

![Export controls](./assets/10-export.png)

---

## Connections

Saved connections with their health. `local-kafka` is registered automatically when the demo broker is running.

![Connections](./assets/11-connections.png)

The Kafka form with SASL_SSL selected: SASL mechanism, CA certificate and credentials, with **Test** available before saving.

![Add connection — Kafka with SASL_SSL](./assets/12-connection-form.png)

---

## Settings

Global defaults, the MCP server address and the authoring docs link for AI agents.

![Settings](./assets/13-settings.png)
