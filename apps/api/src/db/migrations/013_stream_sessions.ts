import type { Knex } from "knex";

const STATES_NEW = ["idle", "streaming", "paused", "stopped", "error"];
const STATES_OLD = ["idle", "streaming", "paused", "stopped"];

/** `streams` gains the `error` state, its own `destinations` and the current session; each
 * start becomes a row in `stream_sessions` (data-model.md §1.7). `runs.retry_count` also lands
 * here: it numbers the `-r<k>` job IDs of a failed run's retries (R13). */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("runs", (table) => {
    table.smallint("retry_count").unsigned().notNullable().defaultTo(0);
  });

  await knex.raw(
    `ALTER TABLE \`streams\` MODIFY \`state\` ENUM(${STATES_NEW.map((v) => `'${v}'`).join(",")}) NOT NULL DEFAULT 'idle'`,
  );
  await knex.schema.alterTable("streams", (table) => {
    table.json("destinations").nullable();
    table.string("current_session_id", 26).nullable();
    table.text("last_error").nullable();
  });

  // A stream created before this migration used its run's launch destinations.
  const streams = await knex("streams").select("id", "run_id");
  for (const stream of streams) {
    const rows = await knex("run_destinations").where({ run_id: stream.run_id });
    const destinations = rows
      .filter((row) => row.connection_id)
      .map((row) => ({
        sink: row.sink_name,
        connection_id: row.connection_id,
        ...(row.topic ? { topic: row.topic } : {}),
        ...(row.routing_key ? { routing_key: row.routing_key } : {}),
        ...(row.label_topic ? { label_topic: row.label_topic } : {}),
      }));
    await knex("streams")
      .where({ id: stream.id })
      .update({ destinations: JSON.stringify(destinations) });
  }

  await knex.schema.createTable("stream_sessions", (table) => {
    table.string("id", 26).primary();
    table
      .string("stream_id", 26)
      .notNullable()
      .references("id")
      .inTable("streams")
      .onDelete("CASCADE");
    table.integer("seq").unsigned().notNullable();
    table.unique(["stream_id", "seq"]);
    table.integer("engine_version").unsigned().notNullable();
    table.json("destinations_snapshot").notNullable();
    table.json("resume_from").notNullable();
    table.bigInteger("sim_time_ms").nullable();
    table.bigInteger("delivered").unsigned().notNullable().defaultTo(0);
    table.bigInteger("failed").unsigned().notNullable().defaultTo(0);
    table.bigInteger("duplicates_injected").unsigned().notNullable().defaultTo(0);
    table.integer("delivered_since_checkpoint").unsigned().notNullable().defaultTo(0);
    table.integer("last_checkpoint_day").nullable();
    table.text("last_error").nullable();
    table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("ended_at").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("runs", (table) => {
    table.dropColumn("retry_count");
  });
  await knex.schema.dropTableIfExists("stream_sessions");
  await knex("streams").where({ state: "error" }).update({ state: "stopped" });
  await knex.schema.alterTable("streams", (table) => {
    table.dropColumn("destinations");
    table.dropColumn("current_session_id");
    table.dropColumn("last_error");
  });
  await knex.raw(
    `ALTER TABLE \`streams\` MODIFY \`state\` ENUM(${STATES_OLD.map((v) => `'${v}'`).join(",")}) NOT NULL DEFAULT 'idle'`,
  );
}
