import type { Knex } from "knex";

/** `run_deliveries` (data-model.md §1.6): one row per bound broker sink for a run launched with
 * `replay_history`. It tracks the replay of `delivered/<sink>/` to the destination, with a cursor
 * so a failed replay continues instead of starting over. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("run_deliveries", (table) => {
    table.string("run_id", 26).notNullable().references("id").inTable("runs").onDelete("CASCADE");
    table.string("sink_name", 120).notNullable();
    table.primary(["run_id", "sink_name"]);
    table
      .enu("state", ["pending", "running", "done", "failed", "skipped"])
      .notNullable()
      .defaultTo("pending");
    table.json("cursor").nullable();
    table.bigInteger("total").unsigned().notNullable().defaultTo(0);
    table.bigInteger("published").unsigned().notNullable().defaultTo(0);
    table.bigInteger("failed").unsigned().notNullable().defaultTo(0);
    table.json("destination_snapshot").nullable();
    table.text("last_error").nullable();
    table.timestamp("started_at").nullable();
    table.timestamp("finished_at").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("run_deliveries");
}
