import type { Knex } from "knex";
import { ulid } from "ulid";

export interface ScenarioRow {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  current_version_id: string | null;
  template_slug: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateScenarioInput {
  name: string;
  description?: string;
  currency: string;
  template_slug?: string;
}

export class ScenarioRepository {
  constructor(private readonly db: Knex) {}

  async create(input: CreateScenarioInput): Promise<ScenarioRow> {
    const id = ulid();
    await this.db("scenarios").insert({
      id,
      name: input.name,
      description: input.description ?? null,
      currency: input.currency,
      current_version_id: null,
      template_slug: input.template_slug ?? null,
    });
    const row = await this.getById(id);
    if (!row) throw new Error("scenario insert did not round-trip");
    return row;
  }

  getById(id: string): Promise<ScenarioRow | undefined> {
    return this.db<ScenarioRow>("scenarios").where({ id }).first();
  }

  list(limit = 50, cursor?: string): Promise<ScenarioRow[]> {
    const query = this.db<ScenarioRow>("scenarios").orderBy("created_at", "desc").limit(limit);
    if (cursor) query.where("id", "<", cursor);
    return query;
  }

  async update(id: string, patch: { name?: string; description?: string }): Promise<void> {
    await this.db("scenarios")
      .where({ id })
      .update({ ...patch, updated_at: this.db.fn.now() });
  }

  async setCurrentVersion(id: string, versionId: string): Promise<void> {
    await this.db("scenarios")
      .where({ id })
      .update({ current_version_id: versionId, updated_at: this.db.fn.now() });
  }

  async delete(id: string): Promise<void> {
    await this.db("scenarios").where({ id }).delete();
  }
}
