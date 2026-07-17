import { fileURLToPath } from "node:url";
import type { Knex } from "knex";

// Knex resolves a relative `migrations.directory` against `process.cwd()`, not
// this file's location — that cwd is the repo root in both the Docker image
// (`WORKDIR /repo`) and the test runner, never this package's directory, so a
// bare relative path never finds the migrations. Resolve it absolutely instead.
const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url));

function connectionFromEnv(): string | Knex.StaticConnectionConfig {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  return {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "txloom",
    password: process.env.MYSQL_PASSWORD ?? "txloom",
    database: process.env.MYSQL_DATABASE ?? "txloom",
    charset: "utf8mb4",
  };
}

// A function, not a static object: `connection` must be read from
// process.env at the time a connection is actually opened (getDb() call
// time), not at module-import time — tests set DATABASE_URL in `beforeAll`,
// well after this module is first imported transitively via app.js.
export default function createKnexConfig(): Knex.Config {
  return {
    client: "mysql2",
    connection: connectionFromEnv(),
    migrations: {
      directory: migrationsDir,
      extension: "ts",
    },
  };
}
