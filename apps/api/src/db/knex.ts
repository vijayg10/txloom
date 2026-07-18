import knexFactory, { type Knex } from "knex";
import createKnexConfig from "./knexfile.js";

let instance: Knex | undefined;

/** Shared Knex connection (MySQL 8, utf8mb4, no ORM — D2). Lazily constructed so
 * tests can call `closeDb()` between suites without leaking pooled connections. */
export function getDb(): Knex {
  instance ??= knexFactory(createKnexConfig());
  return instance;
}

export async function closeDb(): Promise<void> {
  await instance?.destroy();
  instance = undefined;
}

/** Runs pending migrations under a MySQL named lock (GET_LOCK/RELEASE_LOCK).
 * `docker compose up` starts api and worker with no ordering between them,
 * and both call this at boot — on a *fresh* database, Knex's own migration
 * lock can't help, because its row-level lock lives in a table
 * (`knex_migrations_lock`) that doesn't exist yet: both processes can race
 * to `CREATE TABLE IF NOT EXISTS` it and one loses with
 * ER_TABLE_EXISTS_ERROR. The named lock is acquired out-of-band, before
 * either process touches a migrations table, so the two boots fully
 * serialize instead of racing. */
export async function migrateWithLock(db: Knex): Promise<void> {
  await db.raw("SELECT GET_LOCK('txloom_migrate', 60)");
  try {
    await db.migrate.latest();
  } finally {
    await db.raw("SELECT RELEASE_LOCK('txloom_migrate')");
  }
}
