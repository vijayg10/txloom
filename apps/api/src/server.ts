import { buildApp } from "./app.js";
import { getDb } from "./db/knex.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

// Setup is `docker compose up` with zero required config-file editing
// (constitution Principle IV) — that promise only holds if the schema is
// there when the server starts, so run pending migrations here rather than
// requiring an out-of-band `db:migrate` step.
await getDb().migrate.latest();

const app = await buildApp({ logger: true });

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
