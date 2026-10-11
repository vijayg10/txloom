import { buildApp } from "./app.js";
import { applyEnvConnections, seedOnBoot } from "./services/local-kafka.js";
import { getDb, migrateWithLock } from "./db/knex.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

// Setup is `docker compose up` with zero required config-file editing
// (constitution Principle IV) — that promise only holds if the schema is
// there when the server starts, so run pending migrations here rather than
// requiring an out-of-band `db:migrate` step.
await migrateWithLock(getDb());

// Connections the operator declares, and the bundled demo broker when it is there (FR-013).
// Neither may stop the API from starting: an invalid TXLOOM_CONNECTIONS_JSON is reported, not fatal.
const dataDir = process.env.DATA_DIR ?? "./data";
try {
  await applyEnvConnections(getDb(), dataDir, process.env.TXLOOM_CONNECTIONS_JSON);
} catch (error) {
  console.error((error as Error).message);
}
await seedOnBoot(getDb(), dataDir).catch((error: unknown) => {
  console.error(`local Kafka seeding skipped: ${error instanceof Error ? error.message : error}`);
});

const app = await buildApp({ logger: true });

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
