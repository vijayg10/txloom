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
server, a CLI, and a React studio where everything can be done from the UI.

## Quickstart

```bash
git clone https://github.com/vijayg10/txloom && cd txloom
docker compose up
```

Open **http://localhost:3000**. See the [Installation Guide](https://vijayg10.github.io/txloom/guide/installation.html)
for the full walkthrough (your first run with or without a broker, the
optional demo Kafka broker, connecting an AI agent, the CLI, and the
contributor development setup).

> **No authentication.** TxLoom has no login. Anyone who can reach port 3000 can read every
> scenario and run, launch runs, manage connections and use the MCP endpoint. Run it only on a
> trusted network, or behind a VPN or a reverse proxy that does its own authentication.

## Connections and destinations

Brokers and webhooks are saved once as **connections** (Connections page, `/api/v1/connections`,
or the CLI; agents can list them with the `list_connections` MCP tool): a Kafka cluster
(PLAINTEXT, SSL, SASL with PLAIN or SCRAM, optional CA certificate), a RabbitMQ broker (optional
TLS), or a webhook. **Test** runs from the worker, where publishing happens, and reports the
failing stage (connect, TLS, auth, topic). Secrets are write-only: they are never returned by the
API, logged, or put in a job payload. They are encrypted at rest under an instance key generated
at `data/keys/instance.key` (or supplied with `TXLOOM_INSTANCE_KEY`); back it up, since saved
secrets cannot be recovered without it.

Each non-file sink in a spec is sent to a connection of the same type, chosen as its
**destination** in the Launch drawer on the scenario page (remembered for the next launch).
`history_then_live` runs start their live stream by themselves once history, and any replay
(`replay_history`), is done.

**First run.** On a fresh install with the bundled demo broker
(`docker compose --profile demo-brokers up`) the home page offers **Start the UPI reference run**:
one click clones the UPI reference scenario, generates 90 days of history and starts a live
stream to the `local-kafka` connection (default topic `txloom.events`), which is registered
automatically. Without a broker, pick a file-only template (**Card-present retail** or
**Marketplace payouts**) and launch it as **History only**.

Optional environment variables (full list in
[Configuration](https://vijayg10.github.io/txloom/guide/configuration.html)):

- `TXLOOM_MAX_WORKER_THREADS`: partitions one worker generates at once (default: CPUs − 1,
  bounded by memory). Read by the api and the worker.
- `TXLOOM_MAX_STREAMS`: live streams run at once (default 4). Read by the api and the worker.
- `TXLOOM_CONNECTIONS_JSON`: a JSON array of `{type, name, config, secrets?}` connections created
  at boot and shown read-only (`managed_by: env`). Read by the api.

The shipped `docker-compose.yml` does not pass `TXLOOM_*` variables through; set them under
`environment:` for each service that reads them, for example in a `docker-compose.override.yml`.

## Performance

Reference generation and the Kafka benchmark both run through the API, exactly as a user would
(`pnpm bench:reference`, `pnpm bench:kafka`). The Kafka benchmark launches the reference spec,
holds a real stream session at 1,000 TPS for 30 minutes and passes when at least 99% of
1-second windows are within ±5% of the target with flat worker memory. CI runs two reduced
variants that fail the build on a regression against a committed baseline: `pnpm bench:smoke`
(Kafka, `benchmarks/kafka/baseline-smoke.json`) and `pnpm bench:batch-smoke` (batch generation,
`benchmarks/batch/baseline-smoke.json`).

Published numbers belong here once recorded on the reference hardware (8 vCPU, 16 GB RAM, Linux
with Docker); a 60-second check on a laptop averaged ~985 TPS at the 1,000 TPS target after
start-up. Stream health is live in the Live tab: sink lag (messages owed), backpressure, the
paced rate against the target, failed deliveries, and an error banner if the destination goes down.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development setup and
quality gates, and [Extending TxLoom](https://vijayg10.github.io/txloom/technical/extending.html) for the
sink/typology/imperfection extension points.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
