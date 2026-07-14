import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("scenarios", (table) => {
    table.string("id", 26).primary();
    table.string("name", 120).notNullable().unique();
    table.text("description").nullable();
    table.string("currency", 3).notNullable();
    // FK to spec_versions added once that table exists (002) — nullable until a version is saved.
    table.string("current_version_id", 26).nullable();
    table.string("template_slug", 60).nullable();
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("scenarios");
}
