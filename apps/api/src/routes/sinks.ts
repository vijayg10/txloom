import type { FastifyInstance } from "fastify";
import type { SinkType } from "@txloom/spec";
import { getDb } from "../db/knex.js";
import {
  SinkConnectionRepository,
  type SinkConnectionRow,
} from "../db/repositories/sink-connections.js";

interface SinkConnectionBody {
  type: SinkType;
  name: string;
  config: Record<string, unknown>;
  credentials?: { username: string; password: string } | null;
}

/** Never echoes secrets back — `credentials_enc` is write-only (FR-036 §6). */
function serialize(row: SinkConnectionRow) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
    has_credentials: row.credentials_enc !== null,
    last_test_at: row.last_test_at,
    last_test_ok: row.last_test_ok,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function credentialsJson(credentials: SinkConnectionBody["credentials"]): string | null {
  return credentials ? JSON.stringify(credentials) : null;
}

/** Sink-connection CRUD (FR-036 §6) — credentials are write-only: accepted on
 * create/update, encrypted at rest (D14), and never echoed back in any
 * response (only a `has_credentials` boolean is exposed). */
export default async function sinksRoutes(app: FastifyInstance) {
  const dataDir = process.env.DATA_DIR ?? "./data";
  const repo = new SinkConnectionRepository(getDb(), dataDir);

  app.get("/sinks", async () => {
    const rows = await repo.list();
    return { sinks: rows.map(serialize) };
  });

  app.post("/sinks", async (request, reply) => {
    const body = request.body as SinkConnectionBody;
    const row = await repo.create({
      type: body.type,
      name: body.name,
      config: body.config,
      credentials: credentialsJson(body.credentials ?? null),
    });
    reply.status(201);
    return serialize(row);
  });

  app.get("/sinks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await repo.getById(id);
    if (!row) {
      reply.status(404);
      return { error: { code: "not_found", message: `Sink "${id}" not found` } };
    }
    return serialize(row);
  });

  app.patch("/sinks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<SinkConnectionBody>;
    const existing = await repo.getById(id);
    if (!existing) {
      reply.status(404);
      return { error: { code: "not_found", message: `Sink "${id}" not found` } };
    }
    await repo.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
      ...(body.credentials !== undefined ? { credentials: credentialsJson(body.credentials) } : {}),
    });
    return serialize((await repo.getById(id))!);
  });

  app.delete("/sinks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await repo.delete(id);
    reply.status(204);
  });
}
