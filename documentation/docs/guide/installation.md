# Installation Guide

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker + Docker Compose v2 | Latest | All you need to run TxLoom |
| Node.js | 22+ | Development and the CLI only |
| pnpm | 9 | Development and the CLI only |

Port `3000` must be free. The demo broker profile also uses `9092` (Kafka) and `9080` (Kafka console).


## Clone the Repository

```bash
git clone https://github.com/vijayg10/txloom
cd txloom
```

## Option 1: Docker Compose (Recommended)

```bash
docker compose up
```

No configuration file needs editing. This starts:

| Service | Port | Role |
|---|---|---|
| `api` | 3000 | REST API, WebSocket, MCP endpoint, and the web studio |
| `worker` | — | Generation, delivery, streaming, exports, reports |
| `mysql` | — | Scenarios, spec versions, run metadata, connections |
| `redis` | — | Job queues |

Database migrations run on startup. Open **http://localhost:3000**.

Run outputs and the instance key are written to `./data` on the host.

### With the demo Kafka broker

To try streaming without your own broker:

```bash
docker compose --profile demo-brokers up
```

This adds:

| Service | Port | Role |
|---|---|---|
| `kafka` | 9092 | Single-node Kafka. Containers reach it at `kafka:29092`; tools on your machine use `localhost:9092`. |
| `kafka-mon-ui` | 9080 | Redpanda Console, for browsing topics at `http://localhost:9080` |

TxLoom detects the broker at startup and registers a `local-kafka` connection with the default topic `txloom.events`.

## Your First Run

**With the demo broker.** On an empty install the home page shows **Start the UPI reference run**. One click clones the UPI reference scenario, generates 90 days of history and starts a live stream to `local-kafka`. Watch the events arrive:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:29092 --topic txloom.events --max-messages 5
```

**Without a broker.** Open **Scenarios**, pick **Card-present retail** or **Marketplace payouts** from the template gallery (both write files), click **Launch**, and choose **History only**. When the run completes, use **Inspect**, **Ground truth** and **Export** on the run page.

See [How It Works](../get-to-know/how-it-works.md) for the full walkthrough.

## Connect an AI Agent

Any MCP client can author scenarios against a running instance. The endpoint is `http://localhost:3000/mcp` (streamable HTTP).

Claude Code, in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "txloom": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

The address is also shown under **Settings → Agent integration**. See [Agent Authoring](../technical/agent-authoring.md) for the tool list.

## Use the CLI

The CLI is a thin client over the REST API. It runs from the repository:

```bash
pnpm install
pnpm --filter @txloom/cli dev                       # lists commands
pnpm --filter @txloom/cli dev validate my-spec.json
pnpm --filter @txloom/cli dev connections-list
```

It talks to `http://localhost:3000/api/v1` unless `TXLOOM_API_URL` is set.

| Command | Purpose |
|---|---|
| `validate <spec.json>` | Validate a spec file |
| `run <scenario_id> [--seed N] [--dest sink=connection_id[:topic]]... [--replay-history]` | Launch a run |
| `run-status`, `run-pause`, `run-resume`, `run-cancel`, `run-retry`, `run-regenerate` `<run_id>` | Control a run |
| `stream-start <run_id> [target_tps]` | Start the live stream |
| `stream-pause`, `stream-resume`, `stream-stop` `<run_id>` | Control a stream |
| `stream-set-rate <run_id> <target_tps>` | Change the rate of a running stream |
| `truth-filter <run_id> [--typology T] [--actor-id A] [--status S]` | Browse ground truth |
| `truth-actor-story <run_id> <actor_id>` | Show one actor's campaign |
| `export <run_id> [--format csv\|parquet\|json] [--include-labels] [--source truth\|<sink>]` | Build an export |
| `connections-list`, `connections-add`, `connections-test` | Manage connections |

## Option 2: Development Setup

For working on TxLoom itself, run the infrastructure in Docker and the apps in watch mode:

```bash
pnpm install
docker compose up mysql redis          # infrastructure only
pnpm --filter @txloom/api db:migrate   # database migrations
pnpm dev                               # api + worker + web in watch mode
```

To explore the UI with mocked data and no backend:

```bash
VITE_TXLOOM_MOCK=1 pnpm --filter @txloom/web dev
```

## Running Tests

```bash
pnpm typecheck          # strict TypeScript, every package
pnpm lint
pnpm test               # unit, property, contract, component and golden-master tests
pnpm test:integration   # Testcontainers: MySQL, Redis, Kafka, RabbitMQ (needs Docker)
pnpm test:e2e           # Playwright suite against a real stack
```

See [CONTRIBUTING.md](https://github.com/vijayg10/txloom/blob/main/CONTRIBUTING.md) for the quality gates and conventions.

## Security

::: warning No authentication
TxLoom has no login. Anyone who can reach port 3000 can read every scenario and run, launch runs, manage connections and use the MCP endpoint. Deploy it only on a trusted network. For outside access, put it behind a VPN or a reverse proxy that does its own authentication.
:::

Details are in the [Security](./security.md) page.
