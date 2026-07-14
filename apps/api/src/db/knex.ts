import knexFactory, { type Knex } from "knex";
import knexConfig from "./knexfile.js";

let instance: Knex | undefined;

/** Shared Knex connection (MySQL 8, utf8mb4, no ORM — D2). Lazily constructed so
 * tests can call `closeDb()` between suites without leaking pooled connections. */
export function getDb(): Knex {
  instance ??= knexFactory(knexConfig);
  return instance;
}

export async function closeDb(): Promise<void> {
  await instance?.destroy();
  instance = undefined;
}
