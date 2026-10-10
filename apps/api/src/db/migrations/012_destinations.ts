import type { Knex } from "knex";

// data-model.md §1.4, 1.5, 1.5a: `run_destinations` is the immutable launch-time audit
// record (research R10) — no update path, only insert and read. The two `*_defaults`
// tables are upserted on every launch so the Launch panel can prefill (FR-019, SC-002).

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("run_destinations", (table) => {
    table.string("run_id", 26).notNullable().references("id").inTable("runs").onDelete("CASCADE");
    table.string("sink_name", 120).notNullable();
    table.primary(["run_id", "sink_name"]);
    table
      .string("connection_id", 26)
      .nullable()
      .references("id")
      .inTable("connections")
      .onDelete("SET NULL");
    table.string("connection_name", 120).notNullable();
    table.enum("connection_type", ["kafka", "rabbitmq", "webhook"]).notNullable();
    table.string("topic", 249).nullable();
    table.string("routing_key", 255).nullable();
    table.string("label_topic", 249).nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("scenario_destination_defaults", (table) => {
    table
      .string("scenario_id", 26)
      .notNullable()
      .references("id")
      .inTable("scenarios")
      .onDelete("CASCADE");
    table.string("sink_name", 120).notNullable();
    table.primary(["scenario_id", "sink_name"]);
    table
      .string("connection_id", 26)
      .nullable()
      .references("id")
      .inTable("connections")
      .onDelete("CASCADE");
    table.string("topic", 249).nullable();
    table.string("routing_key", 255).nullable();
    table.string("label_topic", 249).nullable();
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("scenario_launch_defaults", (table) => {
    table
      .string("scenario_id", 26)
      .primary()
      .references("id")
      .inTable("scenarios")
      .onDelete("CASCADE");
    table.enum("mode", ["history_only", "history_then_live"]).notNullable();
    table.integer("target_tps").unsigned().nullable();
    table.boolean("replay_history").notNullable().defaultTo(false);
    table.boolean("label_channel").notNullable().defaultTo(false);
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("scenario_launch_defaults");
  await knex.schema.dropTableIfExists("scenario_destination_defaults");
  await knex.schema.dropTableIfExists("run_destinations");
}
