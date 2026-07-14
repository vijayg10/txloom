import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("runs", (table) => {
    table.string("id", 26).primary();
    table
      .string("scenario_id", 26)
      .notNullable()
      .references("id")
      .inTable("scenarios")
      .onDelete("CASCADE");
    table.index("scenario_id");
    table.string("spec_version_id", 26).notNullable().references("id").inTable("spec_versions");
    table.json("spec_snapshot").notNullable();
    table.bigInteger("seed").unsigned().notNullable();
    table.json("params").notNullable();
    table.enum("mode", ["batch", "batch_then_stream"]).notNullable();
    table
      .enum("status", ["queued", "running", "paused", "completed", "failed", "cancelled"])
      .notNullable()
      .defaultTo("queued");
    table.timestamp("outputs_deleted_at").nullable();
    table.json("progress").nullable();
    table.text("error").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("started_at").nullable();
    table.timestamp("completed_at").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("runs");
}
