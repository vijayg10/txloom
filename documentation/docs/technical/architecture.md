# Architecture

## High-Level Overview

![High-Level Architecture](/txloom-architecture.svg)

TxLoom is two Node.js services, a MySQL database and Redis. The web studio, the CLI and the MCP server are three clients of one REST API.

## Components

### Web Studio

A React single-page application built with Vite and served by the API process.

**Responsibilities:**
- Scenario authoring: JSON editor with schema autocomplete and inline validation, structural preview, version history
- Launching runs and binding sinks to connections
- Run progress and stream health over WebSocket
- Charts, ground-truth browsing and exports

The studio holds no business logic of its own. Everything it does goes through the REST API.

### API

A Fastify server. It exposes the REST API under `/api/v1`, a WebSocket endpoint, the MCP endpoint at `/mcp`, and the built studio.

**Responsibilities:**
- Scenarios, spec versions and templates
- Spec validation and run estimates
- Launching, controlling, retrying and regenerating runs
- Connections and their encrypted secrets
- Stream control and stream sessions
- Inspector data, ground-truth queries and exports

The API never generates events. Launching a run snapshots the spec, fixes the partition count, and enqueues jobs for the worker.

### MCP Server

Mounted at `/mcp` on the API process, using the streamable HTTP transport in stateless mode. Each tool calls the same REST route the studio uses, in-process. There is no separate service and no language model. See [Agent Authoring](./agent-authoring.md).

### Worker

A BullMQ worker process that runs six kinds of job:

| Job | What it does |
|---|---|
| `generate-partition` | Generates one partition of a run's history in a worker thread |
| `report-build` | Merges per-partition statistics into the realism report |
| `deliver` | Replays a sink's delivered history to its broker destination |
| `stream-drive` | Runs the live stream for a run, paced to the target rate |
| `export-build` | Builds export files |
| `connection-test` | Tests a connection from where publishing happens |

Generation is CPU-bound, so it runs in a pool of worker threads, never on an event loop that serves requests.

### Spec, Engine and Sinks Packages

The core is four libraries shared across the apps:

| Package | Contents |
|---|---|
| `@txloom/spec` | Spec types, JSON Schema, semantic invariants, spec diff |
| `@txloom/engine` | The deterministic simulator: population, clock, fraud planner, imperfections, realism statistics |
| `@txloom/sinks` | File writers, Kafka, RabbitMQ and webhook publishers, the delivery pump, the wire format |
| `@txloom/agent-tools` | MCP tool definitions and the agent authoring docs |

### MySQL

Stores scenarios, spec versions, runs and their partitions, connections, launch destinations, streams and stream sessions, deliveries, templates and settings. Migrations run when the API starts.

### Redis

Backs the BullMQ job queues.

### Data Volume

Event data does not go into MySQL. Truth, labels, each sink's delivered copy, exports and the realism report are files under the data directory, mostly Parquet. The API and the worker mount the same directory.

---

## Life of a Run

1. **Launch.** The API validates the destinations, snapshots the spec, records the seed, engine version and partition count, and enqueues one `generate-partition` job per partition.
2. **Generate.** Each partition simulates its slice of the consumer population one day at a time, writing truth, labels and each sink's delivered copy as it goes. Memory stays flat regardless of the number of days.
3. **Report.** When all partitions finish, the realism report is merged from their statistics.
4. **Replay** (optional). For each broker destination, a `deliver` job publishes the sink's delivered history.
5. **Live** (optional). A `stream-drive` job restores the end-of-history world and continues simulating, publishing at the target rate.

Progress and stream metrics are pushed to the studio over WebSocket.

## Design Rules

- **Determinism.** The engine reads no wall clock and uses no unseeded randomness. The same seed and spec give byte-identical output.
- **Truth is immutable.** Imperfections change a sink's delivered copy, never the truth.
- **The answer key stays separate.** No label field appears in an event payload.
- **One API, three clients.** The studio, the CLI and the MCP tools map onto the same endpoints.
- **No embedded language model.** Agents author specs from outside; the validator and engine decide what runs.

## Security Model

TxLoom has no authentication and is meant for a trusted network. Connection secrets are encrypted at rest and never returned by the API. See [docs/security.md](https://github.com/vijayg10/txloom/blob/main/docs/security.md).
