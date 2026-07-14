import type { FastifyInstance } from "fastify";
import { getDb } from "../db/knex.js";

interface SettingRow {
  key: string;
  value: unknown;
}

/** GET/PUT /settings — global defaults, a flat key→value store (data-model.md
 * § settings). PUT upserts every key present in the body; keys already set
 * and not present in the body are left untouched. */
export default async function settingsRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get("/settings", async () => {
    const rows = await db<SettingRow>("settings").select("key", "value");
    return Object.fromEntries(
      rows.map((row) => [
        row.key,
        typeof row.value === "string" ? JSON.parse(row.value) : row.value,
      ]),
    );
  });

  app.put("/settings", async (request) => {
    const body = request.body as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      const updated = await db("settings")
        .where({ key })
        .update({ value: JSON.stringify(value), updated_at: db.fn.now() });
      if (updated === 0) {
        await db("settings").insert({ key, value: JSON.stringify(value) });
      }
    }

    const rows = await db<SettingRow>("settings").select("key", "value");
    return Object.fromEntries(
      rows.map((row) => [
        row.key,
        typeof row.value === "string" ? JSON.parse(row.value) : row.value,
      ]),
    );
  });
}
