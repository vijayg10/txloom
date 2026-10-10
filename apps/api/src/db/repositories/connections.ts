import type { Knex } from "knex";
import { ulid } from "ulid";
import type { ProbeResult } from "@txloom/sinks";
import { getOrCreateInstanceKey, encryptSecret, decryptSecret } from "../../services/secrets.js";

export type ConnectionType = "kafka" | "rabbitmq" | "webhook";
export type ManagedBy = "user" | "env" | "auto";

export interface ConnectionRow<TConfig = unknown> {
  id: string;
  type: ConnectionType;
  name: string;
  config: TConfig;
  credentials_enc: Buffer | null;
  managed_by: ManagedBy;
  last_test_at: Date | null;
  last_test_ok: boolean | null;
  last_test_result: ProbeResult | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateConnectionInput<TConfig = unknown, TSecrets = unknown> {
  type: ConnectionType;
  name: string;
  config: TConfig;
  /** Typed secret object (e.g. `{username,password}`) — encrypted at rest (D14);
   * null for sinks with no secret configured. */
  secrets: TSecrets | null;
  managed_by?: ManagedBy;
}

export interface UpdateConnectionInput<TConfig = unknown, TSecrets = unknown> {
  name?: string;
  config?: TConfig;
  /** Omitted = keep the stored secret; `null` = clear it; an object = replace it. */
  secrets?: TSecrets | null;
}

function rowConfig<TConfig>(row: { config: unknown }): TConfig {
  return (typeof row.config === "string" ? JSON.parse(row.config) : row.config) as TConfig;
}

function rowTestResult(row: { last_test_result: unknown }): ProbeResult | null {
  if (!row.last_test_result) return null;
  return (
    typeof row.last_test_result === "string"
      ? JSON.parse(row.last_test_result)
      : row.last_test_result
  ) as ProbeResult;
}

/**
 * Connections repository (data-model.md §1.1): secrets never round-trip in plaintext once
 * written. `create`/`update` encrypt under the instance key; `decryptSecrets` is the only
 * way back to plaintext, used by the connection-probe and destination-resolution paths.
 */
export class ConnectionRepository {
  constructor(
    private readonly db: Knex,
    private readonly dataDir: string,
  ) {}

  private encrypt(secrets: unknown | null): Buffer | null {
    if (secrets === null) return null;
    return encryptSecret(JSON.stringify(secrets), getOrCreateInstanceKey(this.dataDir));
  }

  decryptSecrets<TSecrets = unknown>(row: ConnectionRow): TSecrets | null {
    if (!row.credentials_enc) return null;
    const plaintext = decryptSecret(row.credentials_enc, getOrCreateInstanceKey(this.dataDir));
    return JSON.parse(plaintext) as TSecrets;
  }

  async create<TConfig, TSecrets>(
    input: CreateConnectionInput<TConfig, TSecrets>,
  ): Promise<ConnectionRow<TConfig>> {
    const id = ulid();
    await this.db("connections").insert({
      id,
      type: input.type,
      name: input.name,
      config: JSON.stringify(input.config),
      credentials_enc: this.encrypt(input.secrets),
      managed_by: input.managed_by ?? "user",
    });
    const row = await this.getById<TConfig>(id);
    if (!row) throw new Error("connection insert did not round-trip");
    return row;
  }

  async getById<TConfig = unknown>(id: string): Promise<ConnectionRow<TConfig> | undefined> {
    const row = await this.db("connections").where({ id }).first();
    if (!row) return undefined;
    return { ...row, config: rowConfig<TConfig>(row), last_test_result: rowTestResult(row) };
  }

  async getByName<TConfig = unknown>(name: string): Promise<ConnectionRow<TConfig> | undefined> {
    const row = await this.db("connections").where({ name }).first();
    if (!row) return undefined;
    return { ...row, config: rowConfig<TConfig>(row), last_test_result: rowTestResult(row) };
  }

  async list<TConfig = unknown>(): Promise<ConnectionRow<TConfig>[]> {
    const rows = await this.db("connections").orderBy("name", "asc");
    return rows.map((row) => ({
      ...row,
      config: rowConfig<TConfig>(row),
      last_test_result: rowTestResult(row),
    }));
  }

  async update<TConfig, TSecrets>(
    id: string,
    patch: UpdateConnectionInput<TConfig, TSecrets>,
  ): Promise<void> {
    const update: Record<string, unknown> = { updated_at: this.db.fn.now() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.config !== undefined) update.config = JSON.stringify(patch.config);
    if (patch.secrets !== undefined) update.credentials_enc = this.encrypt(patch.secrets);
    await this.db("connections").where({ id }).update(update);
  }

  async delete(id: string): Promise<void> {
    await this.db("connections").where({ id }).delete();
  }

  async recordTestResult(id: string, probe: ProbeResult): Promise<void> {
    await this.db("connections").where({ id }).update({
      last_test_at: this.db.fn.now(),
      last_test_ok: probe.ok,
      last_test_result: JSON.stringify(probe),
    });
  }
}
