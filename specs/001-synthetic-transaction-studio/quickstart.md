# Quickstart: TxLoom v1

**Date**: 2026-07-11 | **Plan**: [plan.md](./plan.md)

## Run it (users)

Prerequisites: Docker + Docker Compose.

```bash
git clone https://github.com/<org>/txloom && cd txloom
docker compose up
```

Open **http://localhost:3000**. Target: running studio in under 10 minutes (SC-003).

First dataset in three steps (target: under 15 minutes end to end, SC-002):

1. **Scenario workspace** → *New from template* → "UPI-style instant payments". Prefer plain
   English? Point your own AI agent (Claude Code, Cursor, any MCP client) at
   `http://localhost:3000/mcp` and describe the scenario — the agent authors and validates the
   spec for you (see `docs/agent/`).
2. Review the spec in the editor (inline validation errors, live structural preview) → **Run**.
3. When the run completes: **World inspector** for charts + realism report; **Ground-truth
   explorer** → *Export* to download data files and the separate answer key.

Optional demo brokers for streaming: `docker compose --profile demo-brokers up` adds local
Kafka + RabbitMQ; then configure them under **Connections & settings** and use the
**Stream console**.

## Develop (contributors)

Prerequisites: Node.js 22, pnpm 9, Docker (for MySQL/Redis/Testcontainers).

```bash
pnpm install
docker compose up mysql redis        # infra only
pnpm --filter @txloom/api db:migrate # Knex migrations
pnpm dev                             # api + worker + web (Vite) in watch mode
```

Quality gates (constitution v1.1.0 — all must pass before merge):

```bash
pnpm typecheck   # strict TS, zero errors
pnpm lint        # zero warnings
pnpm format      # Prettier check
pnpm test        # Vitest: unit + property + contract + golden-master
pnpm test:integration  # Testcontainers: MySQL, Redis, Kafka, RabbitMQ
pnpm bench:smoke # CI-scale benchmark, fails on regression threshold
```

Key invariants for contributors:

- Same seed + same spec = byte-identical output. Golden-master tests enforce this; if your
  change legitimately alters output, it is a breaking change — declare it (versioned + changelog).
- No `Math.random`, no wall-clock reads inside `packages/engine` (lint-enforced).
- No language model ships in the product. Agent integration lives in `packages/agent-tools`
  (tool definitions + authoring-docs source) and the API's `/mcp` endpoint; MCP tools must map
  1:1 onto REST endpoints — agents author specs only, never events.
- New sinks implement the `Sink`/`SinkFactory` plugin interface in
  `packages/sinks/src/interface.ts`. Typologies and imperfections currently
  extend by adding a branch to `fraud/orchestrator.ts` /
  `imperfections/pipeline.ts` respectively — see `docs/extending.md` for the
  exact steps and the honest note that formalizing them into a plugin
  registry (like sinks already have) is a documented follow-up, not done yet.

Full benchmark (publishes the README number — 1,000 TPS sustained to Kafka, flat memory):

```bash
pnpm bench:kafka
```
