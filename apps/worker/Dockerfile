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
COPY packages/spec/package.json packages/spec/
COPY packages/engine/package.json packages/engine/
COPY packages/sinks/package.json packages/sinks/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @txloom/worker typecheck

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=builder /repo /repo
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]
