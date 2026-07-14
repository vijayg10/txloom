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

## Why TxLoom, not a prompt-in/rows-out generator

Most synthetic-data tools in this space — ShadowTraffic and similar
prompt-driven generators among them — start from "describe the data you
want, get rows back." TxLoom starts somewhere different: it simulates a
_world_ (consumer personas with income patterns and spend rhythms, a
merchant population, fraud actors running multi-step campaigns) and reads
transactions off of that world as they happen. The practical differences
that follow from that:

- **Ground truth, not just rows.** Every event carries a real cause — a
  salaried consumer's monthly grocery run, a card-testing actor's third
  probe in a burst — and the answer key (`is_fraud`, `typology`, `actor_id`,
  `campaign_step`) is a byproduct of simulating that cause, not a label
  bolted on after the fact.
- **A labeled imperfection layer.** Duplicate delivery, late arrival,
  out-of-order delivery, and clock skew corrupt _delivered_ copies only —
  the truth record stays immutable — and every corruption is enumerated in
  the answer key. You can test a pipeline's resilience to messy real-world
  delivery without hand-rolling the mess yourself.
- **History-to-live continuity.** A run's live-streaming phase continues the
  exact same world (population, RNG stream) the history phase produced —
  no reset, no discontinuity between "the batch dataset" and "the live
  demo."
- **Agent-first, not LLM-embedded.** No language model ships in the
  product. Point any MCP-capable agent you already have (Claude Code,
  Cursor, etc.) at the built-in agent-integration server and it authors a
  spec against the same validator the UI uses — the agent proposes, the
  deterministic engine enforces, and no model ever generates a transaction.
- **Open source, self-hosted, no per-token cost.** Apache-2.0, one
  `docker compose up`, no hosted-only dependency for core functionality.

None of this is a claim that adjacent tools are worse at what _they're_
built for — prompt-driven row generation is a different, valid tool for a
different job. TxLoom's bet is that fraud/payments testing specifically
needs a world with causes and consequences, not just plausible-looking rows.

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
