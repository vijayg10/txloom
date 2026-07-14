import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("streams", (table) => {
    table.string("id", 26).primary();
    table
      .string("run_id", 26)
      .notNullable()
      .unique()
      .references("id")
      .inTable("runs")
      .onDelete("CASCADE");
    table.enum("state", ["idle", "streaming", "paused", "stopped"]).notNullable().defaultTo("idle");
    table.integer("target_tps").unsigned().notNullable();
    table.boolean("label_channel_enabled").notNullable().defaultTo(false);
    table.json("metrics").nullable();
    table.timestamp("started_at").nullable();
    table.timestamp("stopped_at").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("streams");
}
