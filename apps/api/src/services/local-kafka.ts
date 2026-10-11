import { connect } from "node:net";
import { lookup } from "node:dns/promises";
import type { Knex } from "knex";
import { ConnectionRepository } from "../db/repositories/connections.js";
import { validateConnectionBody, type ConnectionBody } from "./connection-validation.js";

/** The bundled demo broker, as the worker reaches it inside the compose network. */
const DEFAULT_LOCAL_KAFKA = "kafka:29092";
const SEEDED_KEY = "local_kafka_seeded";
const PROBE_TIMEOUT_MS = 1000;

/** `host:port` of the local broker. `TXLOOM_LOCAL_KAFKA` overrides it (tests, other setups). */
function localKafkaAddress(): { host: string; port: number; text: string } {
  const text = process.env.TXLOOM_LOCAL_KAFKA || DEFAULT_LOCAL_KAFKA;
  const [host = "kafka", port = "29092"] = text.split(":");
  return { host, port: Number(port), text };
}

/**
 * Whether the bundled demo broker is reachable (FR-013): a DNS lookup of its name, then a TCP
 * connect, each bounded to a second so a missing broker costs boot almost nothing.
 */
export async function probeLocalKafka(): Promise<boolean> {
  const { host, port } = localKafkaAddress();
  try {
    await Promise.race([
      lookup(host),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("dns timeout")), PROBE_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function localKafkaConnection(): ConnectionBody & {
  type: "kafka";
  name: string;
  config: Record<string, unknown>;
} {
  return {
    type: "kafka",
    name: "local-kafka",
    config: {
      bootstrap_servers: [localKafkaAddress().text],
      security_protocol: "PLAINTEXT",
      default_topic: "txloom.events",
    },
  };
}

/** Whether any saved Kafka connection already points at the local broker. */
async function isRegistered(db: Knex, dataDir: string): Promise<boolean> {
  const address = localKafkaAddress().text;
  const rows = await new ConnectionRepository(db, dataDir).list();
  return rows.some(
    (row) =>
      row.type === "kafka" &&
      ((row.config as { bootstrap_servers?: string[] }).bootstrap_servers ?? []).includes(address),
  );
}

/**
 * The connection suggestions for the UI and API (`GET /connections/suggestions`): the local broker,
 * while it is reachable and nothing registered points at it.
 */
export async function suggestions(db: Knex, dataDir = process.env.DATA_DIR ?? "./data") {
  if (await isRegistered(db, dataDir)) return [];
  if (!(await probeLocalKafka())) return [];
  return [
    {
      kind: "local_kafka" as const,
      input: localKafkaConnection(),
      detail: `A Kafka broker is reachable at ${localKafkaAddress().text} (the bundled demo broker).`,
    },
  ];
}

/**
 * Boot-time seeding (FR-013): registers `local-kafka` once, when the demo broker is reachable.
 * `settings.local_kafka_seeded` records that it was done, so a user who deletes the connection is
 * not given it back on the next boot (they can still accept the suggestion).
 */
export async function seedOnBoot(db: Knex, dataDir: string): Promise<void> {
  const seeded = await db("settings").where({ key: SEEDED_KEY }).first();
  if (seeded) return;
  if (await isRegistered(db, dataDir)) return;
  if (!(await probeLocalKafka())) return;
  const repo = new ConnectionRepository(db, dataDir);
  if (!(await repo.getByName("local-kafka"))) {
    const { type, name, config } = localKafkaConnection();
    await repo.create({ type, name, config, secrets: null, managed_by: "auto" });
  }
  await db("settings").insert({ key: SEEDED_KEY, value: JSON.stringify(true) });
}

/**
 * `TXLOOM_CONNECTIONS_JSON` (FR-013): an array of `{type, name, config, secrets?}` connections
 * declared by the operator. They are upserted by name on every boot and marked `managed_by: env`,
 * so the UI shows them read-only and the API refuses to edit or delete them.
 */
export async function applyEnvConnections(
  db: Knex,
  dataDir: string,
  json: string | undefined,
): Promise<void> {
  if (!json) return;
  let entries: ConnectionBody[];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    entries = parsed as ConnectionBody[];
  } catch (error) {
    throw new Error(
      `TXLOOM_CONNECTIONS_JSON is not a JSON array of connections: ${(error as Error).message}`,
    );
  }
  for (const [index, entry] of entries.entries()) {
    const violations = validateConnectionBody(entry, true);
    if (violations.length > 0) {
      throw new Error(
        `TXLOOM_CONNECTIONS_JSON entry ${index} is invalid: ${violations.map((v) => `${v.path} ${v.message}`).join("; ")}`,
      );
    }
  }
  const repo = new ConnectionRepository(db, dataDir);
  for (const entry of entries) {
    const existing = await repo.getByName(entry.name!);
    if (existing) {
      await repo.update(existing.id, {
        config: entry.config,
        ...(entry.secrets !== undefined ? { secrets: entry.secrets } : {}),
      });
      await db("connections").where({ id: existing.id }).update({ managed_by: "env" });
    } else {
      await repo.create({
        type: entry.type!,
        name: entry.name!,
        config: entry.config,
        secrets: entry.secrets ?? null,
        managed_by: "env",
      });
    }
  }
}
