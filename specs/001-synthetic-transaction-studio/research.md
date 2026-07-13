# Phase 0 Research: TxLoom — Synthetic Transaction Studio (v1)

**Date**: 2026-07-11 | **Plan**: [plan.md](./plan.md)

Decisions fall in two groups: **user-decided** (fixed by stack interview on 2026-07-11 — not
revisitable without user sign-off) and **plan-decided** (chosen here with rationale; revisit if
evidence contradicts).

## User-decided (stack interview)

### D1. API framework — Fastify

- **Decision**: Fastify for the single REST + WebSocket service.
- **Rationale**: Fastest mainstream Node HTTP framework; first-class JSON Schema validation via
  Ajv aligns exactly with the spec-validation architecture (one schema technology for API bodies
  and simulation specs); `@fastify/websocket` covers progress/ticker channels; minimal
  abstraction over the event loop, which matters next to a TPS-controlled delivery path.
- **Alternatives considered**: NestJS (rejected by user: heavier DI/decorator abstraction, slower
  request path, framework conventions not needed for one service).

### D2. Database — MySQL 8, no ORM, Knex for migrations + query building

- **Decision**: MySQL 8 stores scenarios, spec versions, runs, sink connections, and settings.
  All access through Knex query building and Knex migrations; no ORM layer.
- **Rationale**: User requirement. Knex gives typed-enough parameterized SQL, a mature migration
  runner, and zero ORM magic — appropriate for a small metadata schema (~8 tables). JSON columns
  hold spec documents and reports.
- **Alternatives considered**: Postgres (concept note's original choice — replaced by user
  decision), Drizzle/Prisma/Kysely (rejected: no ORM wanted).
- **Consequences**: use `JSON` column type + generated columns where indexed lookups into spec
  JSON are needed; `utf8mb4` everywhere; `mysql2` driver under Knex.

### D3. Job queue — BullMQ + Redis

- **Decision**: BullMQ over Redis for chunked parallel generation, streaming drive, and report
  jobs.
- **Rationale**: Per-job progress events, retries, pause/resume, and delayed jobs map directly
  onto run control semantics (per-partition progress bars, idempotent resume). Confirmed by user
  after the MySQL switch (Redis stays for queues only).
- **Alternatives considered**: MySQL-backed poll queue (fewer services but hand-built progress/
  resume), in-process only (no crash recovery, no scale-out).

### D4. Frontend — React 18 + Vite SPA, served by the API container

- **Decision**: Single-page app built with Vite; Fastify serves the built static assets. One
  origin for REST, WS, and UI.
- **Rationale**: Self-hosted dashboard needs no SSR/SEO; one origin removes CORS and keeps
  compose at four containers.
- **Alternatives considered**: Next.js (second server runtime for no benefit here), separate
  nginx container (one more moving part).

### D5. Test framework — Vitest

- **Decision**: Vitest as the single runner across engine, API, workers, and React components.
- **Rationale**: Shares the Vite toolchain, native TS/ESM, Jest-compatible API. Companions:
  fast-check (property tests with tolerance bounds), Testcontainers (MySQL, Redis, Kafka,
  RabbitMQ), Playwright reserved for post-v1 E2E if needed.
- **Alternatives considered**: Jest (slower, transform config), node:test (ecosystem too thin
  for component testing).

### D6. Repo layout — pnpm workspace monorepo

- **Decision**: `apps/{api,worker,web,cli}` + `packages/{spec,engine,sinks,agent-tools}`; plain
  pnpm scripts, no build orchestrator initially. *(Package set revised 2026-07-13: `agent-tools`
  replaces `llm` — see D13.)*
- **Rationale**: Strict dependency isolation; shared spec types flow from `packages/spec` to
  every consumer; engine isolated from delivery and the agent-integration surface per
  constitution Principles I–II.
- **Alternatives considered**: npm workspaces (weaker hoisting control), single package
  (boundaries erode), Turborepo (defer until CI time hurts).

## Plan-decided

### D7. Deterministic randomness — pure-rand source + d3-random distributions

- **Decision**: pure-rand (xoroshiro128+) as the sole seeded PRNG; per-partition substreams
  derived via splitmix-style jump/derivation from the run seed and partition index; d3-random
  distribution generators (lognormal, normal, poisson, exponential) configured with `.source()`
  pointing at the seeded stream. `Math.random` and `Date.now` are lint-banned inside
  `packages/engine`.
- **Rationale**: pure-rand is mature (powers fast-check), fast, and serializable (stream state
  can be checkpointed for idempotent resume); d3-random supplies exactly the distribution set the
  spec format names, and accepts a custom source, so determinism holds end to end.
- **Alternatives considered**: seedrandom (older, no jump/split support), hand-rolled PCG32
  (needless reimplementation), Chance.js (not source-injectable throughout).

### D8. Kafka client — @confluentinc/kafka-javascript

- **Decision**: Confluent's official JavaScript client (librdkafka-based) for the Kafka sink and
  the benchmark.
- **Rationale**: Actively maintained, librdkafka throughput headroom far beyond the 1,000 TPS
  target, built-in backpressure via delivery callbacks/poll loop.
- **Alternatives considered**: KafkaJS (pure JS, easiest API, but effectively unmaintained since
  2023 — risk for a flagship sink), node-rdkafka (same native core, less ergonomic API).
- **Consequences**: native module → multi-stage Docker build with prebuilt binaries; document a
  KafkaJS fallback path in the sink plugin interface if native builds block a platform.

### D9. RabbitMQ client — amqplib

- **Decision**: amqplib with a thin reconnect/confirm-channel wrapper inside the sink plugin;
  publisher confirms drive backpressure; configurable exchange/routing key.
- **Rationale**: The canonical, battle-tested AMQP 0-9-1 client; our wrapper needs are small
  (reconnect, confirms) and live behind the sink interface anyway.
- **Alternatives considered**: rabbitmq-client (nicer TS API and auto-reconnect but far smaller
  ecosystem), amqp-connection-manager (extra dependency for reconnect logic we wrap ourselves).

### D10. Parquet writing — @dsnp/parquetjs

- **Decision**: @dsnp/parquetjs for the Parquet file sink and truth store segments.
- **Rationale**: Maintained fork of parquetjs, pure JS (no native build), row-group streaming
  writes fit the flat-memory requirement.
- **Alternatives considered**: parquet-wasm (faster but Arrow-centric API and wasm payload),
  DuckDB (powerful but a whole embedded database as a file writer). Revisit via benchmark if
  Parquet writing shows up as the bottleneck.

### D11. Truth store layout — filesystem volume, partitioned Parquet + JSONL labels

- **Decision**: Run outputs live on a Docker volume: `runs/<run_id>/truth/part-<n>.parquet`,
  `runs/<run_id>/labels/…`, `exports/…`, `report.json`. MySQL stores only metadata + pointers.
  Deleting a run removes the directory but keeps the MySQL row (spec snapshot + seed) for
  one-click regeneration.
- **Rationale**: Low-millions of events per run do not belong in MySQL; files are already the
  export format; retention-until-manual-delete (clarification #2) becomes directory lifecycle.
- **Alternatives considered**: events in MySQL (write amplification, size), object storage
  (post-v1 concern; volume suffices for self-hosted).

### D12. Spec validation — Ajv (JSON Schema 2020-12) + typed invariant functions

- **Decision**: One Ajv instance validates spec structure; semantic invariants are pure TS
  functions `(spec) → InvariantViolation[]` each returning a JSON-Pointer path, message, and
  machine-readable code. The same battery runs in the API, the editor (via API round-trip), and
  the MCP validate tool.
- **Rationale**: Ajv is Fastify-native; JSON Pointer locations power both Monaco inline markers
  and external agents' repair iterations — one error model for humans, the editor, and agents
  (FR-004, FR-010).
- **Alternatives considered**: Zod (would duplicate the JSON Schema the editor needs for
  autocomplete), custom validator (reinventing Ajv).

### D13. Agent integration — MCP server + shared `agent-tools` package, no embedded LLM *(revised by user decision 2026-07-13)*

- **Decision**: v1 embeds no language model. Authoring assistance is externalized: an MCP server
  (official `@modelcontextprotocol/sdk`, streamable-HTTP transport mounted at `/mcp` on the
  Fastify API) exposes the full authoring-and-run loop as tools; `packages/agent-tools` holds the
  tool definitions (names, schemas, descriptions) and the agent authoring docs (annotated spec
  schema, semantic-invariant error-code catalog with remedies, worked example specs per template)
  as the single source of truth, published to `docs/agent/`. Users bring their own MCP-capable
  agent (Claude Code, Cursor, any MCP client). MCP tools map 1:1 onto REST endpoints — no
  agent-only capabilities.
- **Rationale**: The validator, not the LLM, is the load-bearing component — located,
  machine-actionable violations (D12) let any external agent run the propose→validate→repair
  loop itself. Dropping the embedded compiler removes provider adapters, key management, prompt
  maintenance, and per-compile cost from the core, frees roadmap time, and converts "no embedded
  LLM" into "works with every LLM". It also strengthens the openness principle: the self-hosted
  core has zero dependence on any hosted AI service.
- **Alternatives considered**: embedded compile/repair loop in a `packages/llm` (the original
  plan — superseded by user decision: duplicate authoring codepath, provider support burden,
  positioning risk of leading with "English in, data out"); a separate BFF service hosting an
  agent loop that consumes the MCP server (rejected: a runtime protocol hop and roadmap coupling
  to buy a consistency that a shared library already provides); routing all UI traffic through
  MCP (rejected: wrong transport for progress bars and ticker streams — REST/WS stays the UI
  path).
- **Consequences**: a post-v1 optional **AI-assist plugin** (in-process Fastify plugin behind a
  config flag, bring-your-own key) imports the same `packages/agent-tools` definitions and calls
  the same REST surface directly; the UI reveals its panel only when `GET /capabilities`
  advertises it. Nothing in core changes when it arrives.

### D14. Secrets at rest — AES-256-GCM envelope with instance key

- **Decision**: Sink credentials encrypt with AES-256-GCM under a per-install key
  generated on first boot into the data volume (overridable via env var).
- **Rationale**: v1 has no auth (trusted network) but the constitution/spec require encrypted
  secrets at rest; an instance key is the standard self-hosted pattern (cf. n8n, Metabase).
- **Alternatives considered**: OS keychain (server deployments lack one), plaintext + volume
  encryption (fails the spec's explicit requirement).

### D15. Webhook delivery — plain HTTP POST with bounded retries *(signing removed by user decision 2026-07-13)*

- **Decision**: Webhook deliveries are plain JSON POSTs — no signature header, no per-endpoint
  secret. Retries with exponential backoff + jitter (5 attempts default); failures surface as
  backpressure and console indicators rather than silent drops.
- **Rationale**: User decision — signing adds a verification burden on receivers and a secret
  lifecycle in the product that isn't warranted for a self-hosted, trusted-network test-data
  tool (the v1 trust boundary already assumes anyone who can reach the studio has full access).
- **Alternatives considered**: HMAC-SHA256 Stripe-style signing (the original plan — removed
  2026-07-13; could return post-v1 as an opt-in per-endpoint setting if users testing
  signature-verifying consumers ask for it), JWT-signed payloads (heavier verification story).

### D16. TPS control — token bucket per stream, shared across partitions

- **Decision**: A token-bucket rate limiter owned by the stream-drive job meters delivery;
  worker partitions pull emission credit from it; achieved-vs-target, lag, and backpressure
  gauges publish over the WS stream channel. Backpressure propagates from sink confirms
  (Kafka delivery reports / AMQP confirms / webhook responses) into the bucket.
- **Rationale**: Simple, accurate at 1,000 TPS granularity, and yields the exact observability
  the stream console needs (FR-028).
- **Alternatives considered**: fixed-interval batch timers (bursty at second boundaries),
  leaky-bucket per partition (harder to keep global rate exact).

### D17. Realism report computation — streaming aggregation during generation

- **Decision**: Per-partition streaming aggregators (counts, moments, t-digest quantiles,
  inter-arrival histograms) merge into the run-level report at completion; reference-benchmark
  comparisons read static, sourced JSON files shipped with each template (e.g., RBI UPI
  aggregates for the India pack).
- **Rationale**: Avoids a second full pass over low-millions of events; keeps memory flat;
  mergeable sketches fit the partitioned execution model.
- **Alternatives considered**: post-hoc scan of truth files (simpler but doubles IO and runtime),
  DuckDB queries over Parquet (adds a heavy dependency for v1's fixed report).

### D18. Party display names — deterministic dictionary sampling *(added by user decision 2026-07-13)*

- **Decision**: Payer/payee display names are generated in-engine from per-locale **name
  dictionary packs** — static, sourced data files shipped with templates (e.g., an `en-IN` pack
  with given/family names and category-aware merchant naming patterns for the UPI template).
  Each consumer and merchant is named exactly once at world instantiation, sampling via the same
  pure-rand per-partition substreams as all other generation (D7); the spec's `locale` key
  selects the pack (validated as a semantic invariant). Names are denormalized onto truth events
  (`consumer_name`, `merchant_name`, `counterparty_name`) and flow through deliveries and
  exports unchanged.
- **Rationale**: Keeps the determinism gate intact — names are byte-identical per seed+spec and
  survive resume via the existing RNG checkpoints; keeps the spec small (population remains
  statistical, never enumerated); makes exports read like real seed data for the
  fintech-developer audience and makes actor stories and the event ticker demo-credible.
- **Alternatives considered**: faker-js (rejected: global mutable seeding fits per-partition
  substreams poorly, and its locale packs are heavy transitive data for the two dictionary types
  needed); a separate parties file joined at export time (rejected for v1: flat denormalized
  events are what the seed-data audience consumes; a normalized world/parties export can come
  later); IDs only (rejected 2026-07-13 — the original gap this decision closes).
- **Populating packs**: each pack is a set of small JSON files — weighted given-name and
  family-name lists (`{name, weight}`) plus per-category merchant naming grammars (pattern
  strings like `"{family} Kirana Store"` with supporting word lists) — with source and license
  recorded per file, mirroring the `benchmark_refs` pattern. Sources: public/open datasets where
  they exist (US Census Bureau surname frequencies and SSA given names, both public domain, for
  an `en-US` pack), curated open lists (Wikipedia/Wikidata common Indian given/family names,
  CC BY-SA, for `en-IN`), and hand-written merchant grammars per category. ~500–2,000 weighted
  entries per list suffices: given × family combinatorics yields millions of combinations, and
  weighted sampling reproduces realistic duplicate rates at 200k consumers (name collisions are
  a feature — real populations have them; IDs stay the join key). One-time LLM-assisted
  curation of a list is acceptable — it is static, human-reviewed repo data, not runtime
  generation, so determinism is unaffected. Packs are plain data files, making new locales a
  natural community-contribution surface (CONTRIBUTING.md invitation).

## Resolved Technical Context unknowns

None remain — every Technical Context field in plan.md is concrete. No NEEDS CLARIFICATION
markers were carried into planning.
