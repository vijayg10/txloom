import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("sink_connections", (table) => {
    table.string("id", 26).primary();
    table.enum("type", ["file", "kafka", "rabbitmq", "webhook"]).notNullable();
    table.string("name", 120).notNullable().unique();
    table.json("config").notNullable();
    // AES-256-GCM envelope (D14); null for file and webhook (no signing secret — D15).
    table.binary("credentials_enc").nullable();
    table.timestamp("last_test_at").nullable();
    table.boolean("last_test_ok").nullable();
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("sink_connections");
}
