import type { Knex } from "knex";
import { ulid } from "ulid";
import type { SinkType } from "@txloom/spec";
import { getOrCreateInstanceKey, encryptSecret, decryptSecret } from "../../services/secrets.js";

export interface SinkConnectionRow {
  id: string;
  type: SinkType;
  name: string;
  config: unknown;
  credentials_enc: Buffer | null;
  last_test_at: Date | null;
  last_test_ok: boolean | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSinkConnectionInput {
  type: SinkType;
  name: string;
  config: unknown;
  /** Plaintext secret (e.g. `{username,password}` JSON) — encrypted at rest (D14);
   * null for sinks with no secret (file, webhook per D15). */
  credentials: string | null;
}

/**
 * Sink-connection repository (D14): credentials never round-trip in
 * plaintext once written — `create`/`update` encrypt under the instance key,
 * and callers that need the decrypted secret (the test-connection route,
 * stream-drive job wiring) go through `decryptCredentials` explicitly rather
 * than the row ever carrying plaintext.
 */
export class SinkConnectionRepository {
  constructor(
    private readonly db: Knex,
    private readonly dataDir: string,
  ) {}

  private encrypt(plaintext: string | null): Buffer | null {
    if (plaintext === null) return null;
    return encryptSecret(plaintext, getOrCreateInstanceKey(this.dataDir));
  }

  decryptCredentials(row: SinkConnectionRow): Buffer | null {
    if (!row.credentials_enc) return null;
    const plaintext = decryptSecret(row.credentials_enc, getOrCreateInstanceKey(this.dataDir));
    return Buffer.from(plaintext, "utf-8");
  }

  async create(input: CreateSinkConnectionInput): Promise<SinkConnectionRow> {
    const id = ulid();
    await this.db("sink_connections").insert({
      id,
      type: input.type,
      name: input.name,
      config: JSON.stringify(input.config),
      credentials_enc: this.encrypt(input.credentials),
    });
    const row = await this.getById(id);
    if (!row) throw new Error("sink_connection insert did not round-trip");
    return row;
  }

  getById(id: string): Promise<SinkConnectionRow | undefined> {
    return this.db<SinkConnectionRow>("sink_connections").where({ id }).first();
  }

  list(): Promise<SinkConnectionRow[]> {
    return this.db<SinkConnectionRow>("sink_connections").orderBy("created_at", "desc");
  }

  async update(
    id: string,
    patch: { name?: string; config?: unknown; credentials?: string | null },
  ): Promise<void> {
    const update: Record<string, unknown> = { updated_at: this.db.fn.now() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.config !== undefined) update.config = JSON.stringify(patch.config);
    if (patch.credentials !== undefined) update.credentials_enc = this.encrypt(patch.credentials);
    await this.db("sink_connections").where({ id }).update(update);
  }

  async delete(id: string): Promise<void> {
    await this.db("sink_connections").where({ id }).delete();
  }

  async recordTestResult(id: string, ok: boolean): Promise<void> {
    await this.db("sink_connections")
      .where({ id })
      .update({ last_test_at: this.db.fn.now(), last_test_ok: ok });
  }
}
