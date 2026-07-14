# TxLoom

Synthetic Transaction Studio — a self-hosted payments world simulator: a
deterministic, seeded generation engine, agent-first authoring via an MCP
server, four delivery sinks (files, Kafka, RabbitMQ, webhooks) with
history-to-live streaming, a realism report, and a six-surface React studio.

## Quickstart

```bash
git clone https://github.com/<org>/txloom && cd txloom
docker compose up
```

Open **http://localhost:3000**. See [`specs/001-synthetic-transaction-studio/quickstart.md`](specs/001-synthetic-transaction-studio/quickstart.md)
for the full walkthrough (first dataset in three steps, optional demo
brokers for streaming, and the contributor development setup).

License: Apache-2.0.
