import type { FastifyInstance } from "fastify";
import type { SinkTarget } from "@txloom/sinks";
import { getDb } from "../db/knex.js";
import { ConnectionRepository, type ConnectionRow } from "../db/repositories/connections.js";
import { connectionWarnings, validateConnectionBody, type ConnectionBody } from "../services/connection-validation.js";
import { probeConnection, WorkerUnavailableError } from "../services/connection-probe.js";

function targetFor(type: "kafka" | "rabbitmq" | "webhook", config: Record<string, unknown>): SinkTarget {
  if (type === "kafka") return { topic: config.default_topic as string };
  if (type === "rabbitmq") return { routing_key: config.default_routing_key as string };
  return {};
}

function serialize(row: ConnectionRow) {
  const config = row.config as Record<string, unknown>;
  const warnings = [...connectionWarnings(row.type, config)];
  const topic = row.last_test_result?.topic;
  if (topic && topic.exists === false && !topic.auto_create_allowed) {
    warnings.push({
      code: "topic_missing" as const,
      message: `Topic "${topic.name}" does not exist yet. It will be used once it (or auto-creation) is available.`,
    });
  }
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    config,
    has_credentials: row.credentials_enc !== null,
    managed_by: row.managed_by,
    health: {
      last_test_at: row.last_test_at,
      ok: row.last_test_ok,
      summary: row.last_test_result?.detail ?? null,
      stage: row.last_test_result?.stage ?? null,
    },
    warnings,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function invalidConnection(violations: { path: string; code: string; message: string }[]) {
  return {
    error: {
      code: "invalid_connection",
      message: "Connection failed validation",
      details: { violations },
    },
  };
}

/** Connections CRUD and testing (replaces /sinks, FR-007–FR-013). Secrets are
 * write-only: accepted on create/update, encrypted at rest, and never echoed back —
 * only `has_credentials` is exposed (contract invariant 1). */
export default async function connectionsRoutes(app: FastifyInstance) {
  const db = getDb();
  const dataDir = process.env.DATA_DIR ?? "./data";
  const repo = new ConnectionRepository(db, dataDir);

  app.get("/connections", async () => {
    const rows = await repo.list();
    return { connections: rows.map(serialize) };
  });

  app.post("/connections", async (request, reply) => {
    const body = request.body as ConnectionBody;
    const violations = validateConnectionBody(body, true);
    if (violations.length > 0) {
      reply.status(400);
      return invalidConnection(violations);
    }
    const existing = await repo.getByName(body.name!);
    if (existing) {
      reply.status(409);
      return { error: { code: "name_taken", message: `A connection named "${body.name}" already exists` } };
    }
    const row = await repo.create({
      type: body.type!,
      name: body.name!,
      config: body.config,
      secrets: body.secrets ?? null,
    });
    reply.status(201);
    return serialize(row);
  });

  app.get("/connections/suggestions", async () => {
    // Local-Kafka suggestion (FR-013) ships with US8's T172 — nothing detected yet.
    return { suggestions: [] };
  });

  app.get("/connections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await repo.getById(id);
    if (!row) {
      reply.status(404);
      return { error: { code: "not_found", message: `Connection "${id}" not found` } };
    }
    return serialize(row);
  });

  app.patch("/connections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await repo.getById(id);
    if (!existing) {
      reply.status(404);
      return { error: { code: "not_found", message: `Connection "${id}" not found` } };
    }
    if (existing.managed_by === "env") {
      reply.status(403);
      return {
        error: { code: "managed_connection", message: "This connection is managed by TXLOOM_CONNECTIONS_JSON and can't be edited here" },
      };
    }
    const body = request.body as ConnectionBody;
    const violations = validateConnectionBody({ type: existing.type, ...body }, false);
    if (violations.length > 0) {
      reply.status(400);
      return invalidConnection(violations);
    }
    if (body.name && body.name !== existing.name) {
      const nameClash = await repo.getByName(body.name);
      if (nameClash) {
        reply.status(409);
        return { error: { code: "name_taken", message: `A connection named "${body.name}" already exists` } };
      }
    }
    await repo.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
      ...(body.secrets !== undefined ? { secrets: body.secrets } : {}),
    });
    return serialize((await repo.getById(id))!);
  });

  app.delete("/connections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await repo.getById(id);
    if (!existing) {
      reply.status(404);
      return { error: { code: "not_found", message: `Connection "${id}" not found` } };
    }
    if (existing.managed_by === "env") {
      reply.status(403);
      return {
        error: { code: "managed_connection", message: "This connection is managed by TXLOOM_CONNECTIONS_JSON and can't be deleted here" },
      };
    }
    await repo.delete(id);
    reply.status(204);
  });

  app.post("/connections/test", async (request, reply) => {
    const body = request.body as ConnectionBody;
    const violations = validateConnectionBody(body, true);
    if (violations.length > 0) {
      reply.status(400);
      return invalidConnection(violations);
    }
    const config = body.config as Record<string, unknown>;
    try {
      return await probeConnection(
        { type: body.type!, name: body.name!, config, secrets: body.secrets ?? null },
        targetFor(body.type!, config),
        dataDir,
      );
    } catch (error) {
      if (error instanceof WorkerUnavailableError) {
        reply.status(503);
        return { error: { code: "worker_unavailable", message: error.message } };
      }
      throw error;
    }
  });

  app.post("/connections/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await repo.getById(id);
    if (!row) {
      reply.status(404);
      return { error: { code: "not_found", message: `Connection "${id}" not found` } };
    }
    const config = row.config as Record<string, unknown>;
    const secrets = repo.decryptSecrets(row);
    try {
      const result = await probeConnection(
        { type: row.type, name: row.name, config, secrets },
        targetFor(row.type, config),
        dataDir,
      );
      await repo.recordTestResult(id, result);
      return result;
    } catch (error) {
      if (error instanceof WorkerUnavailableError) {
        reply.status(503);
        return { error: { code: "worker_unavailable", message: error.message } };
      }
      throw error;
    }
  });

  // Removed in favor of /connections (research R10) — kept as a pointer for one
  // minor release rather than a bare 404.
  for (const route of ["/sinks", "/sinks/:id", "/sinks/:id/test"]) {
    app.all(route, async (_request, reply) => {
      reply.status(410);
      return { error: { code: "gone", message: "Sink connections moved to /api/v1/connections" } };
    });
  }
}
