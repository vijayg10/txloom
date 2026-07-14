import { schema } from "@txloom/spec";
import { SCHEMA_FIELD_NOTES, renderSchemaReference } from "./schema-reference.js";
import { INVARIANT_CATALOG, renderInvariantCatalog } from "./invariant-catalog.js";
import { WORKED_EXAMPLES } from "./worked-examples/index.js";

export * from "./schema-reference.js";
export * from "./invariant-catalog.js";
export * from "./worked-examples/index.js";

export interface AuthoringDocs {
  schema: unknown;
  field_notes: typeof SCHEMA_FIELD_NOTES;
  invariant_catalog: typeof INVARIANT_CATALOG;
  worked_examples: typeof WORKED_EXAMPLES;
}

/** Assembles every doc source into the single response GET /spec/docs and the
 * get_authoring_docs MCP tool both return (FR-009) — one source, two transports. */
export function buildAuthoringDocs(): AuthoringDocs {
  return {
    schema,
    field_notes: SCHEMA_FIELD_NOTES,
    invariant_catalog: INVARIANT_CATALOG,
    worked_examples: WORKED_EXAMPLES,
  };
}

/** Markdown rendering — used by scripts/build-agent-docs.ts to publish docs/agent/. */
export function renderAuthoringDocsMarkdown(): string {
  const examplesSection = WORKED_EXAMPLES.map(
    (e) =>
      `## ${e.name} (\`${e.template_slug}\`)\n\n\`\`\`json\n${JSON.stringify(e.spec, null, 2)}\n\`\`\`\n`,
  ).join("\n");

  return [
    "# TxLoom agent authoring guide",
    "",
    "Generated from packages/agent-tools/src/docs — do not hand-edit; run `pnpm build:agent-docs`.",
    "",
    renderSchemaReference(),
    renderInvariantCatalog(),
    "# Worked examples",
    "",
    examplesSection,
  ].join("\n");
}
