import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("run_partitions", (table) => {
    table.string("run_id", 26).notNullable().references("id").inTable("runs").onDelete("CASCADE");
    table.smallint("partition_no").unsigned().notNullable();
    table.primary(["run_id", "partition_no"]);
    table
      .enum("state", ["pending", "running", "done", "failed"])
      .notNullable()
      .defaultTo("pending");
    table.json("rng_checkpoint").nullable();
    table.bigInteger("events_generated").unsigned().notNullable().defaultTo(0);
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("run_partitions");
}
