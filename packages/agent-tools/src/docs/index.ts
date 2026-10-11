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
/** How an agent runs a spec once it is saved: the parts of launch that are not in the spec. */
export function renderRunningGuide(): string {
  return [
    "# Running a scenario",
    "",
    "- **Estimate first.** `estimate_run {spec, replay_history?}` returns `history_events`, `replay_messages`, `partitions` and `generation_seconds` without generating anything. An invalid spec returns `400 spec_invalid` with located violations.",
    "- **Destinations.** Every non-file sink needs a destination: call `list_connections`, pick a connection of the same type (a Kafka sink needs a Kafka connection), and pass `destinations: [{sink, connection_id, topic?}]` to `launch_run`. Addresses and credentials are never passed inline; secrets are never returned.",
    "- **Seeds are strings.** `seed` accepts a decimal string up to 18446744073709551615 so 64-bit seeds survive JSON. Omit it to use the spec's seed; a run is never given a random one.",
    "- **Mode.** `history_only`, or `history_then_live` (the default when any destination is a broker): once history is complete the worker starts the live stream by itself, at `target_tps`.",
    "- **Replay.** `replay_history: true` first sends the whole history to each broker destination; watch the run's `phase` (`generating`, `replaying`, `live`, `done`). The live stream starts only when every replay is done or skipped.",
    "- **Failures.** `retry_run` re-queues only the partitions that did not finish. A run made by an older engine version is refused with `409 engine_version_mismatch`; regenerate it instead.",
    "- **Live streams.** `start_stream` uses the run's destinations (an inline `sink` is rejected with `400 inline_sink_removed`). Each start is a new session that continues the same simulated world.",
    "",
  ].join("\n");
}

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
    renderRunningGuide(),
    "# Worked examples",
    "",
    examplesSection,
  ].join("\n");
}
