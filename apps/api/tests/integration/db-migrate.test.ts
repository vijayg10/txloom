import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import knexFactory, { type Knex } from "knex";

// Relative to this file, not `process.cwd()` — see the comment in
// apps/api/src/db/knexfile.ts for why a bare relative path is wrong here.
const migrationsDir = fileURLToPath(new URL("../../src/db/migrations", import.meta.url));

function asJson(value: unknown): Record<string, unknown> {
  return typeof value === "string"
    ? (JSON.parse(value) as Record<string, unknown>)
    : (value as Record<string, unknown>);
}

// Testcontainers MySQL — every foundational table must migrate up and down cleanly.
// Run via `pnpm test:integration` (requires a local Docker daemon).

const EXPECTED_TABLES = [
  "scenarios",
  "spec_versions",
  "runs",
  "run_partitions",
  "streams",
  "connections",
  "templates",
  "settings",
  "run_destinations",
  "scenario_destination_defaults",
  "scenario_launch_defaults",
];

describe("Knex migration round-trip (Testcontainers MySQL)", () => {
  let container: StartedTestContainer;
  let db: Knex;

  beforeAll(async () => {
    container = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();

    db = knexFactory({
      client: "mysql2",
      connection: {
        host: container.getHost(),
        port: container.getMappedPort(3306),
        user: "root",
        password: "test",
        database: "txloom_test",
        charset: "utf8mb4",
      },
      migrations: { directory: migrationsDir },
    });
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it("migrates every foundational table up cleanly", async () => {
    await db.migrate.latest();
    for (const table of EXPECTED_TABLES) {
      expect(await db.schema.hasTable(table)).toBe(true);
    }
  });

  it("migrates back down cleanly, dropping every foundational table", async () => {
    await db.migrate.rollback(undefined, true);
    for (const table of EXPECTED_TABLES) {
      expect(await db.schema.hasTable(table)).toBe(false);
    }
  });

  it("re-migrating up after a full rollback reaches the same schema", async () => {
    await db.migrate.latest();
    for (const table of EXPECTED_TABLES) {
      expect(await db.schema.hasTable(table)).toBe(true);
    }
  });
});

// Migration 010 backfills `runs`/`run_partitions` for the generation-delivery overhaul.
// This suite migrates up to 009 (the pre-010 schema), inserts rows shaped like the old
// schema, then applies 010 alone and asserts the backfill (research R1, data-model.md §1.2–1.3).
describe("migration 010: runs engine-version and partition-count backfill", () => {
  let container: StartedTestContainer;
  let db: Knex;

  beforeAll(async () => {
    container = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();

    db = knexFactory({
      client: "mysql2",
      connection: {
        host: container.getHost(),
        port: container.getMappedPort(3306),
        user: "root",
        password: "test",
        database: "txloom_test",
        charset: "utf8mb4",
      },
      migrations: { directory: migrationsDir },
    });

    // Step through 001–009 one at a time: `migrate.up()` with no name runs exactly the
    // next pending migration, so nine calls lands exactly on the pre-010 schema.
    for (let i = 0; i < 9; i++) {
      await db.migrate.up();
    }
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it("backfills engine_version, partition_count, mode and the new columns", async () => {
    await db("scenarios").insert({
      id: "01SCENARIO00000000000000AA",
      name: "legacy-scenario",
      currency: "INR",
    });
    await db("spec_versions").insert({
      id: "01SPECVERSION000000000AAA",
      scenario_id: "01SCENARIO00000000000000AA",
      version_no: 1,
      spec: JSON.stringify({}),
      author_type: "user",
    });
    await db("scenarios")
      .where({ id: "01SCENARIO00000000000000AA" })
      .update({ current_version_id: "01SPECVERSION000000000AAA" });

    const batchRunId = "01RUNBATCH0000000000000AA";
    const streamRunId = "01RUNBATCHSTREAM0000000AA";
    await db("runs").insert([
      {
        id: batchRunId,
        scenario_id: "01SCENARIO00000000000000AA",
        spec_version_id: "01SPECVERSION000000000AAA",
        spec_snapshot: JSON.stringify({}),
        seed: 42,
        params: JSON.stringify({}),
        mode: "batch",
        status: "completed",
      },
      {
        id: streamRunId,
        scenario_id: "01SCENARIO00000000000000AA",
        spec_version_id: "01SPECVERSION000000000AAA",
        spec_snapshot: JSON.stringify({}),
        seed: 43,
        params: JSON.stringify({}),
        mode: "batch_then_stream",
        status: "completed",
      },
    ]);
    await db("run_partitions").insert([
      { run_id: batchRunId, partition_no: 0, state: "done" },
      { run_id: batchRunId, partition_no: 1, state: "done" },
      { run_id: batchRunId, partition_no: 2, state: "done" },
      { run_id: streamRunId, partition_no: 0, state: "done" },
    ]);

    await db.migrate.up();

    const batchRun = await db("runs").where({ id: batchRunId }).first();
    expect(batchRun.engine_version).toBe(1);
    expect(batchRun.partition_count).toBe(3);
    expect(batchRun.mode).toBe("history_only");
    expect(Boolean(batchRun.replay_history)).toBe(false);
    expect(batchRun.target_tps).toBeNull();
    expect(Boolean(batchRun.label_channel)).toBe(false);
    expect(batchRun.source_run_id).toBeNull();

    const streamRun = await db("runs").where({ id: streamRunId }).first();
    expect(streamRun.engine_version).toBe(1);
    expect(streamRun.partition_count).toBe(1);
    expect(streamRun.mode).toBe("history_then_live");

    const partitions = await db("run_partitions").where({ run_id: batchRunId });
    for (const partition of partitions) {
      expect(partition.attempts).toBe(0);
      expect(partition.last_error).toBeNull();
    }
  });

  it("rolls migration 010 back down cleanly", async () => {
    await db.migrate.rollback(undefined, false);
    const columns = await db("runs").columnInfo();
    expect(columns.engine_version).toBeUndefined();
    expect(columns.partition_count).toBeUndefined();
  });
});

// Migration 011 renames `sink_connections` to `connections`, drops `file` rows (files need
// no connection) and reshapes each remaining row's `config` into its typed v2 shape
// (data-model.md §1.1, research R10).
describe("migration 011: connections rename and config reshape", () => {
  let container: StartedTestContainer;
  let db: Knex;

  beforeAll(async () => {
    container = await new GenericContainer("mysql:8.4")
      .withEnvironment({ MYSQL_ROOT_PASSWORD: "test", MYSQL_DATABASE: "txloom_test" })
      .withExposedPorts(3306)
      .start();

    db = knexFactory({
      client: "mysql2",
      connection: {
        host: container.getHost(),
        port: container.getMappedPort(3306),
        user: "root",
        password: "test",
        database: "txloom_test",
        charset: "utf8mb4",
      },
      migrations: { directory: migrationsDir },
    });

    // Step through 001–010 (pre-011 schema).
    for (let i = 0; i < 10; i++) {
      await db.migrate.up();
    }
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it("renames the table, drops file rows, and reshapes kafka/rabbitmq/webhook config", async () => {
    await db("sink_connections").insert([
      {
        id: "01CONNFILE0000000000000AA",
        type: "file",
        name: "legacy-file",
        config: JSON.stringify({ path: "./data/out" }),
      },
      {
        id: "01CONNKAFKANOCREDS0000AA",
        type: "kafka",
        name: "legacy-kafka-plain",
        config: JSON.stringify({ brokers: ["broker1:9092", "broker2:9092"], topic: "events" }),
        credentials_enc: null,
      },
      {
        id: "01CONNKAFKACREDS00000AA",
        type: "kafka",
        name: "legacy-kafka-sasl",
        config: JSON.stringify({ brokers: ["secure:9093"], topic: "secure-events" }),
        credentials_enc: Buffer.from(
          Buffer.concat([
            Buffer.alloc(12, 1),
            Buffer.alloc(16, 2),
            Buffer.from(JSON.stringify({ username: "u", password: "p" })),
          ]),
        ),
      },
      {
        id: "01CONNRABBIT000000000AA",
        type: "rabbitmq",
        name: "legacy-rabbit",
        config: JSON.stringify({
          url: "amqp://alice:wonderland@rabbit-host:5672/prod",
          exchange: "txloom",
          routingKey: "events.default",
          exchangeType: "topic",
        }),
      },
      {
        id: "01CONNWEBHOOK00000000AA",
        type: "webhook",
        name: "legacy-webhook",
        config: JSON.stringify({ url: "https://example.com/hook", headers: { "x-token": "abc" } }),
      },
      {
        id: "01CONNUNMAPPABLE00000AA",
        type: "rabbitmq",
        name: "legacy-unmappable",
        config: JSON.stringify({ url: "not a valid url::::", exchange: "x", routingKey: "r" }),
      },
    ]);

    await db.migrate.up();

    expect(await db.schema.hasTable("sink_connections")).toBe(false);
    expect(await db.schema.hasTable("connections")).toBe(true);

    expect(
      await db("connections").where({ id: "01CONNFILE0000000000000AA" }).first(),
    ).toBeUndefined();

    const plainKafka = await db("connections").where({ id: "01CONNKAFKANOCREDS0000AA" }).first();
    const plainConfig = asJson(plainKafka.config);
    expect(plainConfig.bootstrap_servers).toEqual(["broker1:9092", "broker2:9092"]);
    expect(plainConfig.default_topic).toBe("events");
    expect(plainConfig.security_protocol).toBe("PLAINTEXT");
    expect(plainConfig.sasl_mechanism).toBeUndefined();

    const saslKafka = await db("connections").where({ id: "01CONNKAFKACREDS00000AA" }).first();
    const saslConfig = asJson(saslKafka.config);
    expect(saslConfig.security_protocol).toBe("SASL_SSL");
    expect(saslConfig.sasl_mechanism).toBe("PLAIN");

    const rabbit = await db("connections").where({ id: "01CONNRABBIT000000000AA" }).first();
    const rabbitConfig = asJson(rabbit.config);
    expect(rabbitConfig.host).toBe("rabbit-host");
    expect(rabbitConfig.port).toBe(5672);
    expect(rabbitConfig.vhost).toBe("prod");
    expect(rabbitConfig.default_routing_key).toBe("events.default");
    expect(rabbit.credentials_enc).not.toBeNull();

    const webhook = await db("connections").where({ id: "01CONNWEBHOOK00000000AA" }).first();
    const webhookConfig = asJson(webhook.config);
    expect(webhookConfig.url).toBe("https://example.com/hook");
    expect(webhookConfig.timeout_ms).toBe(5000);
    expect(webhookConfig.max_attempts).toBe(5);
    expect(webhook.credentials_enc).not.toBeNull();

    const unmappable = await db("connections").where({ id: "01CONNUNMAPPABLE00000AA" }).first();
    expect(Boolean(unmappable.last_test_ok)).toBe(false);
  });
});
