import type { Knex } from "knex";
import { encryptSecret, getOrCreateInstanceKey } from "../../services/secrets.js";

// data-model.md §1.1: `sink_connections` -> `connections`, `file` rows dropped (files need
// no connection), and each remaining row's `config`/`credentials_enc` reshaped into the
// typed v2 config (research R10). A row whose config can't be mapped is kept as-is with
// `last_test_ok = false`, so it still shows up in the UI for the user to fix or recreate.

interface LegacyRow {
  id: string;
  type: "file" | "kafka" | "rabbitmq" | "webhook";
  name: string;
  config: string | Record<string, unknown>;
  credentials_enc: Buffer | null;
}

function parseConfig(config: string | Record<string, unknown>): Record<string, unknown> {
  return typeof config === "string" ? (JSON.parse(config) as Record<string, unknown>) : config;
}

function dataDir(): string {
  return process.env.DATA_DIR ?? "./data";
}

function reshapeKafka(old: Record<string, unknown>): Record<string, unknown> {
  return {
    bootstrap_servers: old.brokers,
    security_protocol: "PLAINTEXT",
    default_topic: old.topic,
    ...(old.partitionKeyField ? { partition_key_field: old.partitionKeyField } : {}),
  };
}

function reshapeKafkaWithCredentials(old: Record<string, unknown>): Record<string, unknown> {
  return {
    bootstrap_servers: old.brokers,
    security_protocol: "SASL_SSL",
    sasl_mechanism: "PLAIN",
    default_topic: old.topic,
    ...(old.partitionKeyField ? { partition_key_field: old.partitionKeyField } : {}),
  };
}

interface RabbitReshape {
  config: Record<string, unknown>;
  secretsJson: string | null;
}

function reshapeRabbit(old: Record<string, unknown>): RabbitReshape {
  const url = new URL(old.url as string);
  const vhost = decodeURIComponent(url.pathname.replace(/^\//, "")) || "/";
  const config: Record<string, unknown> = {
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "amqps:" ? 5671 : 5672,
    vhost,
    tls: url.protocol === "amqps:",
    exchange: old.exchange,
    exchange_type: old.exchangeType ?? "topic",
    default_routing_key: old.routingKey,
  };
  const secretsJson =
    url.username || url.password
      ? JSON.stringify({
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        })
      : null;
  return { config, secretsJson };
}

function reshapeWebhook(old: Record<string, unknown>): {
  config: Record<string, unknown>;
  secretsJson: string | null;
} {
  const config = {
    url: old.url,
    timeout_ms: 5000,
    max_attempts: old.maxAttempts ?? 5,
  };
  const headers = old.headers as Record<string, string> | undefined;
  const secretsJson = headers && Object.keys(headers).length ? JSON.stringify({ headers }) : null;
  return { config, secretsJson };
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.renameTable("sink_connections", "connections");

  await knex("connections").where({ type: "file" }).delete();

  await knex.schema.alterTable("connections", (table) => {
    table.enum("managed_by", ["user", "env", "auto"]).notNullable().defaultTo("user");
    table.json("last_test_result").nullable();
  });

  const rows = await knex<LegacyRow>("connections").select();
  const key = getOrCreateInstanceKey(dataDir());

  for (const row of rows) {
    const oldConfig = parseConfig(row.config);
    try {
      if (row.type === "kafka") {
        const config = row.credentials_enc
          ? reshapeKafkaWithCredentials(oldConfig)
          : reshapeKafka(oldConfig);
        await knex("connections")
          .where({ id: row.id })
          .update({ config: JSON.stringify(config) });
      } else if (row.type === "rabbitmq") {
        const { config, secretsJson } = reshapeRabbit(oldConfig);
        await knex("connections")
          .where({ id: row.id })
          .update({
            config: JSON.stringify(config),
            credentials_enc: secretsJson ? encryptSecret(secretsJson, key) : null,
          });
      } else if (row.type === "webhook") {
        const { config, secretsJson } = reshapeWebhook(oldConfig);
        await knex("connections")
          .where({ id: row.id })
          .update({
            config: JSON.stringify(config),
            credentials_enc: secretsJson ? encryptSecret(secretsJson, key) : null,
          });
      }
    } catch (error) {
      await knex("connections")
        .where({ id: row.id })
        .update({
          last_test_ok: false,
          last_test_result: JSON.stringify({
            ok: false,
            stage: "resolve",
            detail: `could not migrate this connection's configuration (${(error as Error).message}); recreate it`,
            latency_ms: 0,
          }),
        });
    }
  }

  await knex.raw(
    "ALTER TABLE `connections` MODIFY `type` ENUM('kafka','rabbitmq','webhook') NOT NULL",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    "ALTER TABLE `connections` MODIFY `type` ENUM('file','kafka','rabbitmq','webhook') NOT NULL",
  );
  await knex.schema.alterTable("connections", (table) => {
    table.dropColumn("managed_by");
    table.dropColumn("last_test_result");
  });
  await knex.schema.renameTable("connections", "sink_connections");
}
