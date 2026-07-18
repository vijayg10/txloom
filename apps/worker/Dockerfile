# Multi-stage build — native @confluentinc/kafka-javascript bindings need build
# tooling at install time but not at runtime (D8 consequence).
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
# apps/worker/src/index.ts imports apps/api/src/db + services/queues directly
# (shared DB/queue wiring, not a published package) — its deps must be
# installed here too, or both the typecheck below and the runtime `node
# --import tsx` entrypoint fail to resolve knex/ulid/bullmq.
COPY apps/api/package.json apps/api/
COPY packages/spec/package.json packages/spec/
COPY packages/engine/package.json packages/engine/
COPY packages/sinks/package.json packages/sinks/
# The worker also runs `db.migrate.latest()` at boot (idempotent race guard
# against the api doing the same) — knex must load every migration file to
# resolve pending ones, including 009_seed_templates.ts, which imports
# @txloom/agent-tools (zod).
COPY packages/agent-tools/package.json packages/agent-tools/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @txloom/worker typecheck

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=builder /repo /repo
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]
