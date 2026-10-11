# Technical Stack

TxLoom is TypeScript end to end, organized as a pnpm workspace.

## Repository Layout

| Path | Contents |
|---|---|
| `apps/api` | Fastify REST API, WebSocket, MCP endpoint, migrations |
| `apps/worker` | BullMQ job consumers and the generation thread pool |
| `apps/web` | React studio |
| `apps/cli` | `txloom` command-line client |
| `apps/e2e` | Playwright end-to-end suite |
| `packages/spec` | Spec types, JSON Schema, invariants |
| `packages/engine` | Simulation engine |
| `packages/sinks` | File and broker sinks, delivery pump |
| `packages/agent-tools` | MCP tool definitions and authoring docs |
| `benchmarks` | Generation and Kafka benchmarks |

## Backend

| Component | Technology | Notes |
|---|---|---|
| Language | TypeScript 5 | Strict mode |
| Runtime | Node.js 22+ | |
| Web framework | Fastify 5 | REST, static hosting, WebSocket via `@fastify/websocket` |
| Job queue | BullMQ 5 | On Redis |
| Thread pool | Piscina | `worker_threads` for CPU-bound generation |
| Database | MySQL 8.4 | Scenarios, versions, run metadata, connections |
| Query builder | Knex 3 | Migrations and queries, no ORM |
| Queue backend | Redis 7 | |
| Validation | Ajv 8 | JSON Schema for specs and connection bodies |
| Analytical queries | DuckDB | Queries run output files for the ground-truth views |
| MCP | `@modelcontextprotocol/sdk` | Streamable HTTP transport |

### Why BullMQ and Worker Threads

Generation is split into partitions of the consumer population. Each partition is one job, so a failed partition is retried on its own and a crashed run resumes where it stopped. Inside the worker, partitions run in a thread pool sized to the machine, which keeps CPU-bound work off the event loop.

### Why Files for Event Data

A reference-scale run is tens of millions of events. Writing them as Parquet files per partition keeps generation fast and memory flat, keeps MySQL small, and makes a run's output a plain folder that can be copied or deleted.

### Why No ORM

The relational data is small and simple. Knex gives explicit SQL and migrations without a mapping layer.

## Engine

| Component | Technology | Notes |
|---|---|---|
| Random numbers | `pure-rand` | xoroshiro128+, seeded from the full 64-bit seed |
| Distributions | `d3-random` | Lognormal, normal, exponential, driven by the seeded generator |
| Event IDs | ULID | Derived deterministically |

## Sinks

| Component | Technology | Notes |
|---|---|---|
| Kafka | `@confluentinc/kafka-javascript` | librdkafka-based producer |
| RabbitMQ | `amqplib` | Confirm channels |
| Webhook | Node `fetch` | JSON `POST` |
| Parquet | `@dsnp/parquetjs` | Incremental writers |

## Frontend

| Component | Technology | Notes |
|---|---|---|
| UI framework | React 18 | |
| Build tool | Vite | |
| Routing | React Router 7 | |
| Styling | Tailwind CSS 4 | |
| Components | Radix UI primitives, Lucide icons | |
| Spec editor | Monaco | JSON Schema autocomplete and inline markers |
| Charts | Recharts | |
| Real-time | Native WebSocket | Run progress and stream metrics |

## Testing and Quality

| Layer | Technology | Notes |
|---|---|---|
| Unit, contract, component | Vitest | |
| Property tests | fast-check | For engine invariants such as achieved fraud rate |
| Golden master | Vitest | Pins engine output for a reference spec and seed |
| Integration | Testcontainers | Real MySQL, Redis, Kafka and RabbitMQ |
| End to end | Playwright | Black-box suite against a real stack |
| Lint and format | ESLint, Prettier | Lint rules forbid wall-clock reads and `Math.random` in the engine |

## Infrastructure

| Component | Technology |
|---|---|
| Packaging | Docker images for `api` and `worker` |
| Orchestration | Docker Compose, with an optional `demo-brokers` profile |
| Package manager | pnpm 9 workspaces |
| CI | GitHub Actions |
