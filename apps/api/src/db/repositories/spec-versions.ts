import type { Knex } from "knex";
import { ulid } from "ulid";

export type AuthorType = "user" | "agent" | "rollback";

export interface SpecVersionRow {
  id: string;
  scenario_id: string;
  version_no: number;
  spec: unknown;
  author_type: AuthorType;
  parent_version_id: string | null;
  created_at: Date;
}

export interface CreateSpecVersionInput {
  scenario_id: string;
  spec: unknown;
  author_type: AuthorType;
  parent_version_id?: string | null;
}

/** Append-only version history — rollback creates a new head pointing at old
 * content rather than mutating history (FR-005). */
export class SpecVersionRepository {
  constructor(private readonly db: Knex) {}

  async create(input: CreateSpecVersionInput): Promise<SpecVersionRow> {
    const last = await this.db("spec_versions")
      .where({ scenario_id: input.scenario_id })
      .orderBy("version_no", "desc")
      .first();
    const versionNo = (last?.version_no ?? 0) + 1;
    const id = ulid();

    await this.db("spec_versions").insert({
      id,
      scenario_id: input.scenario_id,
      version_no: versionNo,
      spec: JSON.stringify(input.spec),
      author_type: input.author_type,
      parent_version_id: input.parent_version_id ?? null,
    });

    const row = await this.getById(id);
    if (!row) throw new Error("spec_version insert did not round-trip");
    return row;
  }

  getById(id: string): Promise<SpecVersionRow | undefined> {
    return this.db<SpecVersionRow>("spec_versions").where({ id }).first();
  }

  listByScenario(scenarioId: string): Promise<SpecVersionRow[]> {
    return this.db<SpecVersionRow>("spec_versions")
      .where({ scenario_id: scenarioId })
      .orderBy("version_no", "desc");
  }

  async rollback(scenarioId: string, targetVersionId: string): Promise<SpecVersionRow> {
    const target = await this.getById(targetVersionId);
    if (!target || target.scenario_id !== scenarioId) {
      throw new Error(`spec version "${targetVersionId}" not found for scenario "${scenarioId}"`);
    }
    return this.create({
      scenario_id: scenarioId,
      spec: target.spec,
      author_type: "rollback",
      parent_version_id: targetVersionId,
    });
  }
}
