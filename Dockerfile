# The one txloom image: API, worker and web UI. What runs is chosen by the command.
#   docker compose: api  -> default CMD; worker -> `node --import tsx apps/worker/src/index.ts`
#   Kubernetes:     api + worker in one container via deploy/docker/entrypoint.sh
# Native @confluentinc/kafka-javascript bindings need build tooling at install
# time but not at runtime.
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/spec/package.json packages/spec/
COPY packages/engine/package.json packages/engine/
COPY packages/sinks/package.json packages/sinks/
COPY packages/agent-tools/package.json packages/agent-tools/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @txloom/web build
RUN pnpm --filter @txloom/api... --filter=!@txloom/web typecheck
RUN pnpm --filter @txloom/worker typecheck

FROM base AS runtime
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /repo
COPY --from=builder /repo /repo
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
