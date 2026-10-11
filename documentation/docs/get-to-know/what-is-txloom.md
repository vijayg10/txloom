# What is TxLoom?

TxLoom is an open-source, self-hosted **payments world simulator**. It models a population of consumers, a merchant population, and fraud actors running multi-step campaigns over a simulated clock, then reads transactions off that world as they happen.

Because the events come out of a simulation, each one carries ground truth as a byproduct: whether it is fraud, which typology produced it, which actor ran the campaign, and which step of the campaign it was. TxLoom hands you the data and the answer key separately.

Data is delivered as files (CSV, Parquet, JSON) or as live streams to Kafka, RabbitMQ and webhooks at a rate you control.

**About the name:** a loom weaves separate threads into one fabric. TxLoom weaves legitimate traffic, fraud campaigns and deliberate data imperfections into one stream of transactions (Tx).

---

## The Problem It Solves

Everyone building or testing financial software needs transaction data, and very few people can get it.

- **Real payment data is locked away** behind privacy regulation and commercial sensitivity.
- **Fraud teams need labeled examples**, and real fraud is a fraction of a percent of real volume.
- **Platform teams need event streams with realistic failure modes**: duplicates, late arrivals, out-of-order delivery. Clean static files do not exercise a pipeline.
- **Product teams need seed data that behaves like customers**: salary on the 1st, weekend spending, festival-week spikes, the occasional declined payment.

TxLoom addresses these with four properties:

- **A behavioral world model.** Consumer archetypes have income patterns and spending rhythms. Merchants belong to categories with their own amount distributions. Seasonality windows raise volume. Fraud actors run their campaigns inside legitimate traffic.
- **Ground-truth labels.** Every event is traceable to the actor and typology that produced it, and the labels export as a separate answer key.
- **Labeled imperfections.** Duplicates, late arrival, out-of-order delivery and clock skew are injected into what each sink receives. Each injected fault is labeled, so you know exactly which records your deduplication or ordering logic should have caught.
- **History-to-live continuity.** Generate 90 days of history, then the same world continues as a live stream. Live traffic still has income credits, weekday rhythm, seasonality and fraud campaigns.

---

## Who It's For

- **Fraud and risk teams** who train or benchmark detection models and rules against known truth
- **Platform and data engineers** who test payment switches, stream processors, ledgers and reconciliation jobs against realistic, imperfect event streams
- **Fintech developers** who need demo and seed data that looks like real customer behavior

---

## Key Concepts

| Concept | Description |
|---|---|
| **Scenario** | A named simulation you author and keep. It has a version history of specs. |
| **Spec** | The JSON document that describes the world: population, seasonality, fraud, imperfections and outputs. It is validated before anything runs. |
| **Run** | One execution of a spec version with a seed. A completed run is an immutable record that can be regenerated exactly. |
| **Typology** | A fraud pattern. TxLoom ships card testing, account takeover and refund abuse. |
| **Imperfection** | A deliberate delivery fault: duplicate, late arrival, out of order, or clock skew. |
| **Sink** | An output declared in the spec: a file, a Kafka topic, a RabbitMQ exchange or a webhook. |
| **Connection** | A saved broker or webhook endpoint. At launch, each non-file sink is sent to a connection of the same type. |
| **Answer key** | The label set for a run: fraud labels and imperfection labels, kept apart from the event data. |
| **Realism report** | Per-run statistics: amount distribution, inter-arrival times, achieved fraud rate against the target. |

---

## No Embedded Language Model

TxLoom does not ship or call a language model. Transactions are produced by a deterministic, seeded engine.

Plain-English authoring comes through the AI agent you already use. TxLoom exposes an MCP server, and any MCP client (Claude Code, Cursor and others) can write a scenario spec, validate it, launch a run and read the results. The agent proposes a spec; the validator and the engine decide what runs. See [Agent Authoring](../technical/agent-authoring.md).

---

## Open Source

TxLoom is Apache 2.0 licensed and runs entirely on your own infrastructure with one `docker compose up`.

[View on GitHub →](https://github.com/vijayg10/txloom)
