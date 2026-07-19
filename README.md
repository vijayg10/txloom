# TxLoom

> **Status: active development.** TxLoom is not yet ready for production
> or general usage — APIs, data formats, and behavior may change without
> notice.

Synthetic Transaction Studio — a self-hosted payments world simulator.
TxLoom simulates a world of consumer personas, a merchant population, and
fraud actors running multi-step campaigns, then reads transactions off of
that world as they happen. Every event carries ground truth (`is_fraud`,
`typology`, `actor_id`, `campaign_step`) as a byproduct of the simulation
itself. A deterministic, seeded generation engine delivers data through
four sinks (files, Kafka, RabbitMQ, webhooks) with history-to-live
streaming, a labeled imperfection layer (duplicates, late/out-of-order
delivery, clock skew), a realism report, agent-first authoring via an MCP
server, and a six-surface React studio.

## Quickstart

```bash
git clone https://github.com/<org>/txloom && cd txloom
docker compose up
```

Open **http://localhost:3000**. See [`specs/001-synthetic-transaction-studio/quickstart.md`](specs/001-synthetic-transaction-studio/quickstart.md)
for the full walkthrough (first dataset in three steps, optional demo
brokers for streaming, and the contributor development setup).

## Performance

Streaming holds the configured TPS within tolerance and publishes
achieved-vs-target throughput, sink lag, and backpressure as live metrics
(`GET /runs/:id/stream`, the stream console). The published benchmark:
sustained delivery to Kafka with flat memory over the run — run it yourself
with `pnpm bench:kafka` (see [`CONTRIBUTING.md`](CONTRIBUTING.md)); the
reduced-scale CI variant (`pnpm bench:smoke`) runs on every PR and fails the
build on regression below its committed baseline
(`benchmarks/kafka/baseline-smoke.json`).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development setup and
quality gates, and [`docs/extending.md`](docs/extending.md) for the
sink/typology/imperfection extension points.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
