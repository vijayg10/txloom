import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("templates", (table) => {
    table.string("slug", 60).primary();
    table.string("name", 120).notNullable();
    table.text("description").notNullable();
    table.json("spec").notNullable();
    table.json("benchmark_refs").notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("templates");
}
