import { z } from "zod";

/** Shared MCP tool definitions — names, input schemas, descriptions — the
 * single source of truth for the API's `/mcp` server and any future in-process
 * AI-assist plugin (D13). Every tool maps 1:1 onto a REST endpoint below; no
 * agent-only capability exists (FR-008/012). */
export interface AgentToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  /** The REST endpoint this tool maps onto — documentation + the parity contract test's source of truth. */
  restEndpoint: { method: "GET" | "POST"; path: string };
}

export const getSpecSchemaTool: AgentToolDefinition<Record<string, never>> = {
  name: "get_spec_schema",
  description:
    "Fetch the JSON Schema for a TxLoom SimulationSpec — the structural shape every scenario spec must satisfy.",
  inputSchema: {},
  restEndpoint: { method: "GET", path: "/spec/schema" },
};

export const getAuthoringDocsTool: AgentToolDefinition<Record<string, never>> = {
  name: "get_authoring_docs",
  description:
    "Fetch agent authoring documentation: an annotated spec-schema reference, the semantic-invariant error catalog (codes + remedies), and worked example specs per gallery template.",
  inputSchema: {},
  restEndpoint: { method: "GET", path: "/spec/docs" },
};

export const listTemplatesTool: AgentToolDefinition<Record<string, never>> = {
  name: "list_templates",
  description:
    "List the scenario templates available to clone from (UPI-style, card-present retail, mobile money, marketplace payouts).",
  inputSchema: {},
  restEndpoint: { method: "GET", path: "/templates" },
};

export const listConnectionsTool: AgentToolDefinition<Record<string, never>> = {
  name: "list_connections",
  description:
    "List the saved delivery connections (Kafka, RabbitMQ, webhook) a run can be sent to. Secrets are never returned. Use a connection's id as a destination at launch.",
  inputSchema: {},
  restEndpoint: { method: "GET", path: "/connections" },
};

export const validateSpecInputShape = { spec: z.record(z.string(), z.unknown()) };
export const validateSpecTool: AgentToolDefinition<typeof validateSpecInputShape> = {
  name: "validate_spec",
  description:
    "Validate a candidate SimulationSpec document. Always 200s — even for an invalid spec — returning {valid, violations[]}, each violation located by JSON Pointer with a machine-readable code and human message. Side-effect-free: use this to iterate before saving.",
  inputSchema: validateSpecInputShape,
  restEndpoint: { method: "POST", path: "/spec/validate" },
};

export const createScenarioInputShape = {
  name: z.string().min(1),
  description: z.string().optional(),
  currency: z.string().length(3),
  template_slug: z.string().optional(),
};
export const createScenarioTool: AgentToolDefinition<typeof createScenarioInputShape> = {
  name: "create_scenario",
  description:
    "Create a new (blank, or cloned from a template) scenario. Returns the scenario record; save a spec version next.",
  inputSchema: createScenarioInputShape,
  restEndpoint: { method: "POST", path: "/scenarios" },
};

export const saveSpecVersionInputShape = {
  scenario_id: z.string().min(1),
  spec: z.record(z.string(), z.unknown()),
};
export const saveSpecVersionTool: AgentToolDefinition<typeof saveSpecVersionInputShape> = {
  name: "save_spec_version",
  description:
    "Validate and save a spec as the scenario's new version-history head. Rejects with 422 + located violations (the same shape validate_spec returns) if the spec is invalid — repair and retry.",
  inputSchema: saveSpecVersionInputShape,
  restEndpoint: { method: "POST", path: "/scenarios/:id/versions" },
};

export const launchRunInputShape = {
  scenario_id: z.string().min(1),
  seed: z
    .union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()])
    .optional()
    .describe(
      "Run seed, 0 to 18446744073709551615. Pass it as a decimal string: numbers above 9007199254740991 lose precision in JSON. Omit to use the spec's seed.",
    ),
  mode: z.enum(["batch", "batch_then_stream", "history_only", "history_then_live"]).optional(),
  destinations: z
    .array(
      z.object({
        sink: z.string().min(1),
        connection_id: z.string().min(1),
        topic: z.string().optional(),
        routing_key: z.string().optional(),
        label_topic: z.string().optional(),
      }),
    )
    .optional(),
  replay_history: z
    .boolean()
    .optional()
    .describe(
      "Send the whole generated history to the broker destinations once generation finishes, before any live stream. Default false.",
    ),
};
export const launchRunTool: AgentToolDefinition<typeof launchRunInputShape> = {
  name: "launch_run",
  description:
    'Launch a run of the scenario\'s current spec version. Every non-file sink in the spec needs a destination: a saved connection (see list_connections) of the same type. Snapshots the spec verbatim (immutable record) and starts generation. With replay_history, each broker sink then receives the full history (watch run-progress phase "replaying"; a failed replay needs a retry or skip before streaming).',
  inputSchema: launchRunInputShape,
  restEndpoint: { method: "POST", path: "/scenarios/:id/runs" },
};

export const getRunStatusInputShape = { run_id: z.string().min(1) };
export const getRunStatusTool: AgentToolDefinition<typeof getRunStatusInputShape> = {
  name: "get_run_status",
  description: "Fetch a run's immutable record: status, spec snapshot, seed.",
  inputSchema: getRunStatusInputShape,
  restEndpoint: { method: "GET", path: "/runs/:id" },
};

export const retryRunInputShape = { run_id: z.string().min(1) };
export const retryRunTool: AgentToolDefinition<typeof retryRunInputShape> = {
  name: "retry_run",
  description:
    "Retry a failed run: re-queues only the partitions that did not finish and returns the run to running. Allowed only from failed (409 invalid_state otherwise), and not for a run made by a different engine version (409 engine_version_mismatch — regenerate instead).",
  inputSchema: retryRunInputShape,
  restEndpoint: { method: "POST", path: "/runs/:id/retry" },
};

export const getRealismReportInputShape = { run_id: z.string().min(1) };
export const getRealismReportTool: AgentToolDefinition<typeof getRealismReportInputShape> = {
  name: "get_realism_report",
  description:
    "Fetch a completed run's realism report: distribution summaries, achieved-vs-target fraud rate, seasonality effects.",
  inputSchema: getRealismReportInputShape,
  restEndpoint: { method: "GET", path: "/runs/:id/report" },
};

export const createExportInputShape = {
  run_id: z.string().min(1),
  format: z.enum(["csv", "parquet", "json"]),
  include_labels: z.boolean().optional(),
  acknowledged_warning: z.boolean().optional(),
  source: z
    .union([
      z.object({ kind: z.literal("truth") }),
      z.object({ kind: z.literal("sink"), name: z.string().min(1) }),
    ])
    .optional(),
};
export const createExportTool: AgentToolDefinition<typeof createExportInputShape> = {
  name: "create_export",
  description:
    'Start a data export for a run. It is asynchronous: the call returns status "queued", and get_export reports queued, running, then completed (or failed with an error). source is {kind:"truth"} or {kind:"sink", name} for a file sink\'s delivered copy; it defaults to the first file sink, else truth. include_labels:true REQUIRES acknowledged_warning:true or the call fails (labels are excluded by default — FR-021/022).',
  inputSchema: createExportInputShape,
  restEndpoint: { method: "POST", path: "/runs/:id/exports" },
};

export const getExportInputShape = { run_id: z.string().min(1), export_id: z.string().min(1) };
export const getExportTool: AgentToolDefinition<typeof getExportInputShape> = {
  name: "get_export",
  description:
    "Fetch an export's status (queued, running, completed or failed, with an error) and file names. Poll it after create_export until it is completed or failed.",
  inputSchema: getExportInputShape,
  restEndpoint: { method: "GET", path: "/runs/:id/exports/:exportId" },
};

export const getTruthEventsInputShape = {
  run_id: z.string().min(1),
  typology: z.string().optional(),
  actor_id: z.string().optional(),
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().optional(),
};
export const getTruthEventsTool: AgentToolDefinition<typeof getTruthEventsInputShape> = {
  name: "get_truth_events",
  description:
    "Filter/browse a completed run's ground truth: labeled events with typology, actor, and status, cursor-paginated.",
  inputSchema: getTruthEventsInputShape,
  restEndpoint: { method: "GET", path: "/runs/:id/truth/events" },
};

export const startStreamInputShape = {
  run_id: z.string().min(1),
  target_tps: z.number().positive().optional(),
  label_channel_enabled: z.boolean().optional(),
};
export const startStreamTool: AgentToolDefinition<typeof startStreamInputShape> = {
  name: "start_stream",
  description:
    "Continue a completed run's history phase into a live TPS-paced stream, delivered to the destinations the run was launched with.",
  inputSchema: startStreamInputShape,
  restEndpoint: { method: "POST", path: "/runs/:id/stream/start" },
};

export const stopStreamInputShape = { run_id: z.string().min(1) };
export const stopStreamTool: AgentToolDefinition<typeof stopStreamInputShape> = {
  name: "stop_stream",
  description: "Stop a run's live stream.",
  inputSchema: stopStreamInputShape,
  restEndpoint: { method: "POST", path: "/runs/:id/stream/stop" },
};

/** The full v1 toolset (contracts/api.md § MCP server). */
export const ALL_AGENT_TOOLS: readonly AgentToolDefinition[] = [
  getSpecSchemaTool,
  getAuthoringDocsTool,
  listTemplatesTool,
  listConnectionsTool,
  validateSpecTool as AgentToolDefinition,
  createScenarioTool as AgentToolDefinition,
  saveSpecVersionTool as AgentToolDefinition,
  launchRunTool as AgentToolDefinition,
  getRunStatusTool as AgentToolDefinition,
  retryRunTool as AgentToolDefinition,
  getRealismReportTool as AgentToolDefinition,
  createExportTool as AgentToolDefinition,
  getExportTool as AgentToolDefinition,
  getTruthEventsTool as AgentToolDefinition,
  startStreamTool as AgentToolDefinition,
  stopStreamTool as AgentToolDefinition,
];
