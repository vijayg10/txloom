import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("spec_versions", (table) => {
    table.string("id", 26).primary();
    table
      .string("scenario_id", 26)
      .notNullable()
      .references("id")
      .inTable("scenarios")
      .onDelete("CASCADE");
    table.index("scenario_id");
    table.integer("version_no").unsigned().notNullable();
    table.unique(["scenario_id", "version_no"]);
    table.json("spec").notNullable();
    table.enum("author_type", ["user", "agent", "rollback"]).notNullable();
    table.string("parent_version_id", 26).nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable("scenarios", (table) => {
    table
      .foreign("current_version_id")
      .references("id")
      .inTable("spec_versions")
      .onDelete("SET NULL");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("scenarios", (table) => {
    table.dropForeign(["current_version_id"]);
  });
  await knex.schema.dropTableIfExists("spec_versions");
}
