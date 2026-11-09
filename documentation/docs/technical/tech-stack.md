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
| `benchmarks` | Batch generation and Kafka benchmarks, plus an install smoke test |
| `analytics`, `analytics-flink` | Optional downstream analytics stacks (see [Infrastructure](#infrastructure)) |
| `documentation` | This documentation site |

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
| Analytical queries | DuckDB | Queries run output Parquet files for the ground-truth views |
| MCP | `@modelcontextprotocol/sdk` | Streamable HTTP transport |

### Why BullMQ and Worker Threads

Generation is split into partitions of the consumer population. Each partition is one job, so a failed partition is retried on its own and a crashed run resumes where it stopped. Inside the worker, partitions run in a thread pool, which keeps CPU-bound work off the event loop.

The pool is bounded by both CPU and memory: `min(cores − 1, 0.6 × RAM in GiB)`, with a minimum of one thread. At a budget of about 1 GiB per thread, concurrent partitions never use more than about 60% of the machine's memory. Set `TXLOOM_MAX_WORKER_THREADS` to override the computed size.

### Why Files for Event Data

A reference-scale run is tens of millions of events. Writing them as Parquet files per partition keeps generation fast and memory flat, keeps MySQL small, and makes a run's output a plain folder that can be copied or deleted.

### Why No ORM

The relational data is small and simple. Knex gives explicit SQL and migrations without a mapping layer.

## Engine

| Component | Technology | Notes |
|---|---|---|
| Random numbers | `pure-rand` | xoroshiro128+, seeded from the full 64-bit seed |
| Distributions | `d3-random` | Lognormal, normal, exponential, driven by the seeded generator |
| Event IDs | ULID | Derived deterministically from the seeded generator and virtual clock |

## Sinks

| Component | Technology | Notes |
|---|---|---|
| Kafka | `@confluentinc/kafka-javascript` | librdkafka-based producer |
| RabbitMQ | `amqplib` | Confirm channels |
| Webhook | Node `fetch` | JSON `POST` |
| Parquet | `@dsnp/parquetjs` | Incremental writers; the format for run output |
| CSV, JSON | Built-in writers | Export formats alongside Parquet |

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

## Command-Line Client

The `txloom` CLI has no runtime dependencies. It calls the REST API with Node's built-in `fetch`.

## Testing and Quality

| Layer | Technology | Notes |
|---|---|---|
| Unit, contract, component | Vitest | |
| Property tests | fast-check | For engine invariants such as achieved fraud rate |
| Golden master | Vitest | Pins engine output for a reference spec and seed |
| Integration | Testcontainers | Real MySQL, Redis, Kafka and RabbitMQ |
| End to end | Playwright | Black-box suite against a real stack |
| Performance | Smoke benchmarks | Kafka and batch generation, checked against a committed baseline |
| Lint and format | ESLint, Prettier | Lint rules forbid wall-clock reads and `Math.random` in the engine |

## Infrastructure

| Component | Technology |
|---|---|
| Packaging | Docker images for `api` and `worker` |
| Orchestration | Docker Compose, with an optional `demo-brokers` profile |
| Package manager | pnpm 9 workspaces |
| CI | GitHub Actions |
| Documentation | VuePress 2, deployed to GitHub Pages |

### Compose Profiles

The `demo-brokers` profile adds a local Kafka 3.9 broker and Redpanda Console for browsing topics. RabbitMQ is not part of the profile. To try the RabbitMQ sink, point a connection at your own broker.

### CI Gates

The CI workflow runs these gates as parallel jobs:

- Static checks: typecheck, lint and format.
- Unit, contract and component tests, including the golden master.
- Integration tests on Testcontainers.
- Kafka and batch generation smoke benchmarks, which fail on a regression against the baseline.
- The Playwright end-to-end suite.

### Analytics Stacks

Two optional Compose files add downstream analytics. Each runs on top of `docker-compose.yml` and consumes the `demo-brokers` Kafka broker.

| File | Stack |
|---|---|
| `docker-compose-analytics.yaml` | Kafka → ClickHouse 25.8 → Grafana 12 |
| `docker-compose-flink.yaml` | Kafka → Flink 2.2 jobs → ClickHouse, with MinIO, Prometheus and Grafana |

See `analytics/README.md` and `analytics-flink/README.md` for setup and dashboards.
