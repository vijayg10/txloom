import { getDb, closeDb } from "./knex.js";

const direction = process.argv[2] ?? "latest";
const db = getDb();

try {
  if (direction === "rollback") {
    await db.migrate.rollback();
  } else {
    await db.migrate.latest();
  }
  console.log(`migrations: ${direction} ok`);
} finally {
  await closeDb();
}
