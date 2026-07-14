# Contributing to TxLoom

TxLoom is Apache-2.0 and built to be extended — see
[`docs/extending.md`](docs/extending.md) for the sink/typology/imperfection
plugin surfaces (FR-027) and [`docs/security.md`](docs/security.md) for the
trust-boundary/secrets model.

## Before you start

Read [`.specify/memory/constitution.md`](.specify/memory/constitution.md).
It's short and it's binding: determinism, test-first development, and
measured performance claims aren't style preferences here — they're the
product's core guarantees ("regenerate exactly this dataset," "the answer
key is trustworthy"), and PRs that violate them get rejected regardless of
how the rest of the change looks.

The two rules that catch the most first-time contributions:

- **No `Math.random`, no wall-clock reads, no `new Date()` inside
  `packages/engine/src/**`.** Every random draw flows through
  `packages/engine/src/rng.ts`; every timestamp flows through the injected
  virtual clock (`clock.ts`) or arithmetic on `spec.clock.start`. This is
  lint-enforced (`eslint.config.js`), so `pnpm lint` catches violations
  before review.
- **Same seed + same spec = byte-identical output, forever**, unless you're
  making a deliberate, declared breaking change. If your change legitimately
  alters generated output, update the golden-master fixture
  (`packages/engine/tests/golden-master/reference-output.json`) in the same
  PR and say so in the PR description — don't let CI catch it as a surprise.

## Development setup

```bash
pnpm install
docker compose up mysql redis        # infra only
pnpm --filter @txloom/api db:migrate
pnpm dev                             # api + worker + web in watch mode
```

## Quality gates (all must pass before merge — constitution § Development Workflow)

```bash
pnpm typecheck   # strict TS, zero errors, every package
pnpm lint        # zero warnings
pnpm format      # Prettier check
pnpm test        # Vitest: unit + property + contract + component + golden-master
pnpm test:integration  # Testcontainers: MySQL, Redis, Kafka, RabbitMQ (needs Docker)
pnpm bench:smoke # CI-scale Kafka benchmark, fails on regression (needs a broker — see below)
```

`pnpm bench:smoke` needs `KAFKA_BROKERS` pointed at a reachable broker — use
the compose demo-brokers profile:

```bash
docker compose --profile demo-brokers up kafka
KAFKA_BROKERS=localhost:9092 pnpm bench:smoke
```

## Test-first, for real

Constitution Principle III is not a suggestion for engine, validator, and
API code: write the failing test, watch it fail, then implement. PRs that
add a new invariant, engine construct, or endpoint without a paired test
(rejection case AND explanation-message case for invariants; golden-master
for engine constructs; contract test for endpoints) will be asked to add
one before review continues.

## Commit / PR conventions

- One logical change per PR; commit messages explain _why_, not just _what_.
- If your change touches `packages/engine` output, regenerate and commit the
  golden-master fixture, and call out the breaking change explicitly.
- New sinks/typologies/imperfections: follow `docs/extending.md`'s steps and
  wire every integration point it lists (routes, worker job dispatch,
  migrations) — a plugin that only half-registers won't be usable from the
  UI/CLI/MCP surfaces, which breaks Principle IV (one API, every client
  reaches every capability).

## Reporting issues

Use the repository's issue tracker. For security issues, see
[`docs/security.md`](docs/security.md) before filing publicly.
