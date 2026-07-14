import type { FastifyInstance } from "fastify";
import {
  kafkaSinkFactory,
  rabbitMqSinkFactory,
  webhookSinkFactory,
  type KafkaSinkConfig,
  type RabbitMqSinkConfig,
  type WebhookSinkConfig,
} from "@txloom/sinks";
import { getDb } from "../db/knex.js";
import { SinkConnectionRepository } from "../db/repositories/sink-connections.js";

/** POST /sinks/:id/test — dispatches to each sink plugin's testConnection
 * (T053, T158–T160). File sinks have no remote connection to probe. */
export default async function sinkTestRoutes(app: FastifyInstance) {
  const dataDir = process.env.DATA_DIR ?? "./data";
  const repo = new SinkConnectionRepository(getDb(), dataDir);

  app.post("/sinks/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await repo.getById(id);
    if (!row) {
      reply.status(404);
      return { error: { code: "not_found", message: `Sink "${id}" not found` } };
    }

    const config = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
    const credentials = repo.decryptCredentials(row);

    let result: { ok: boolean; detail: string };
    try {
      switch (row.type) {
        case "file":
          result = { ok: true, detail: "local file sink — no connection to test" };
          break;
        case "kafka": {
          const sink = kafkaSinkFactory.create(row.name, config as KafkaSinkConfig, credentials);
          result = await sink.testConnection();
          await sink.close();
          break;
        }
        case "rabbitmq": {
          const sink = rabbitMqSinkFactory.create(
            row.name,
            config as RabbitMqSinkConfig,
            credentials,
          );
          result = await sink.testConnection();
          await sink.close();
          break;
        }
        case "webhook": {
          const sink = webhookSinkFactory.create(
            row.name,
            config as WebhookSinkConfig,
            credentials,
          );
          result = await sink.testConnection();
          await sink.close();
          break;
        }
      }
    } catch (error) {
      result = { ok: false, detail: (error as Error).message };
    }

    await repo.recordTestResult(id, result.ok);
    return result;
  });
}
