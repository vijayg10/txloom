import type { Knex } from "knex";

// Widens `mode` to include both the old and new values so existing rows can be
// remapped before the enum is narrowed back down (data-model.md §1.2).
const MODE_TRANSITIONAL = ["batch", "batch_then_stream", "history_only", "history_then_live"];
const MODE_NEW = ["history_only", "history_then_live"];
const MODE_OLD = ["batch", "batch_then_stream"];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("runs", (table) => {
    // DEFAULT 1 both satisfies "new engine-versioned runs" and backfills every
    // existing row to engine version 1 (research R1).
    table.integer("engine_version").unsigned().notNullable().defaultTo(1);
    // Backfilled below from `run_partitions`; the 0 default only covers runs with none.
    table.smallint("partition_count").unsigned().notNullable().defaultTo(0);
    table.boolean("replay_history").notNullable().defaultTo(false);
    table.integer("target_tps").unsigned().nullable();
    table.boolean("label_channel").notNullable().defaultTo(false);
    table
      .string("source_run_id", 26)
      .nullable()
      .references("id")
      .inTable("runs")
      .onDelete("SET NULL");
  });

  await knex("runs").update({
    partition_count: knex.raw(
      "(SELECT COUNT(*) FROM run_partitions WHERE run_partitions.run_id = runs.id)",
    ),
  });

  await knex.raw(
    `ALTER TABLE \`runs\` MODIFY \`mode\` ENUM(${MODE_TRANSITIONAL.map((v) => `'${v}'`).join(",")}) NOT NULL`,
  );
  await knex("runs").where({ mode: "batch" }).update({ mode: "history_only" });
  await knex("runs").where({ mode: "batch_then_stream" }).update({ mode: "history_then_live" });
  await knex.raw(
    `ALTER TABLE \`runs\` MODIFY \`mode\` ENUM(${MODE_NEW.map((v) => `'${v}'`).join(",")}) NOT NULL`,
  );

  await knex.schema.alterTable("run_partitions", (table) => {
    table.tinyint("attempts").unsigned().notNullable().defaultTo(0);
    table.text("last_error").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("run_partitions", (table) => {
    table.dropColumn("attempts");
    table.dropColumn("last_error");
  });

  await knex.raw(
    `ALTER TABLE \`runs\` MODIFY \`mode\` ENUM(${MODE_TRANSITIONAL.map((v) => `'${v}'`).join(",")}) NOT NULL`,
  );
  await knex("runs").where({ mode: "history_only" }).update({ mode: "batch" });
  await knex("runs").where({ mode: "history_then_live" }).update({ mode: "batch_then_stream" });
  await knex.raw(
    `ALTER TABLE \`runs\` MODIFY \`mode\` ENUM(${MODE_OLD.map((v) => `'${v}'`).join(",")}) NOT NULL`,
  );

  await knex.schema.alterTable("runs", (table) => {
    table.dropForeign(["source_run_id"]);
    table.dropColumn("source_run_id");
    table.dropColumn("label_channel");
    table.dropColumn("target_tps");
    table.dropColumn("replay_history");
    table.dropColumn("partition_count");
    table.dropColumn("engine_version");
  });
}
