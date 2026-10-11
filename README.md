# TxLoom

<p align="center">
  <img src="assets/images/txloom_logo_whitebg_h.png" alt="TxLoom" width="360" />
</p>

**📖 [Documentation](https://vijayg10.github.io/txloom/)**

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

## Connections and destinations

Brokers and webhooks are saved once as **connections** (Connections page, `/api/v1/connections`,
or the `list_connections` MCP tool): a Kafka cluster (PLAINTEXT, SSL, SASL with PLAIN or SCRAM,
optional CA certificate), a RabbitMQ broker, or a webhook. **Test** runs from the worker, where
publishing happens, and reports the failing stage (connect, TLS, auth, topic). Secrets are
write-only: they are never returned by the API, logged, or put in a job payload.

Each non-file sink in a spec is sent to a connection of the same type, chosen as its
**destination** in the Launch drawer on the scenario page (remembered for the next launch).
`history_then_live` runs start their live stream by themselves once history, and any replay
(`replay_history`), is done.

**First run.** On a fresh install with the bundled demo broker
(`docker compose --profile demo-brokers up`) the home page offers one button that clones the UPI
reference scenario and streams it to the `local-kafka` connection, which is registered
automatically.

Optional environment variables:

- `TXLOOM_MAX_WORKER_THREADS`: generation threads per worker (default: CPUs − 1, bounded by memory).
- `TXLOOM_MAX_STREAMS`: live streams run at once (default 4).
- `TXLOOM_CONNECTIONS_JSON`: a JSON array of `{type, name, config, secrets?}` connections created
  at boot and shown read-only (`managed_by: env`).

## Performance

Reference generation and the Kafka benchmark both run through the API, exactly as a user would
(`pnpm bench:reference`, `pnpm bench:kafka`). The Kafka benchmark launches the reference spec,
holds a real stream session at 1,000 TPS for 30 minutes and passes when at least 99% of
1-second windows are within ±5% of the target with flat worker memory. `pnpm bench:smoke` is the
reduced CI variant and fails the build on regression below `benchmarks/kafka/baseline-smoke.json`.

Published numbers belong here once recorded on the reference hardware (8 vCPU, 16 GB RAM, Linux
with Docker); a 60-second check on a laptop averaged ~985 TPS at the 1,000 TPS target after
start-up. Stream health is live in the Live tab: sink lag (messages owed), backpressure, the
paced rate against the target, failed deliveries, and an error banner if the destination goes down.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development setup and
quality gates, and [`docs/extending.md`](docs/extending.md) for the
sink/typology/imperfection extension points.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
