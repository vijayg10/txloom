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

export const validateSpecInputShape = { spec: z.unknown() };
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

export const saveSpecVersionInputShape = { scenario_id: z.string().min(1), spec: z.unknown() };
export const saveSpecVersionTool: AgentToolDefinition<typeof saveSpecVersionInputShape> = {
  name: "save_spec_version",
  description:
    "Validate and save a spec as the scenario's new version-history head. Rejects with 422 + located violations (the same shape validate_spec returns) if the spec is invalid — repair and retry.",
  inputSchema: saveSpecVersionInputShape,
  restEndpoint: { method: "POST", path: "/scenarios/:id/versions" },
};

export const launchRunInputShape = {
  scenario_id: z.string().min(1),
  seed: z.number().int().optional(),
  mode: z.enum(["batch", "batch_then_stream"]).optional(),
};
export const launchRunTool: AgentToolDefinition<typeof launchRunInputShape> = {
  name: "launch_run",
  description:
    "Launch a run of the scenario's current spec version. Snapshots the spec verbatim (immutable record) and starts generation.",
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
};
export const createExportTool: AgentToolDefinition<typeof createExportInputShape> = {
  name: "create_export",
  description:
    "Create a data export for a run. include_labels:true REQUIRES acknowledged_warning:true or the call fails (labels are excluded by default — FR-021/022).",
  inputSchema: createExportInputShape,
  restEndpoint: { method: "POST", path: "/runs/:id/exports" },
};

export const getExportInputShape = { run_id: z.string().min(1), export_id: z.string().min(1) };
export const getExportTool: AgentToolDefinition<typeof getExportInputShape> = {
  name: "get_export",
  description: "Fetch an export's status and file names.",
  inputSchema: getExportInputShape,
  restEndpoint: { method: "GET", path: "/runs/:id/exports/:exportId" },
};

/** The full v1 toolset (contracts/api.md § MCP server). */
export const ALL_AGENT_TOOLS: readonly AgentToolDefinition[] = [
  getSpecSchemaTool,
  getAuthoringDocsTool,
  listTemplatesTool,
  validateSpecTool as AgentToolDefinition,
  createScenarioTool as AgentToolDefinition,
  saveSpecVersionTool as AgentToolDefinition,
  launchRunTool as AgentToolDefinition,
  getRunStatusTool as AgentToolDefinition,
  getRealismReportTool as AgentToolDefinition,
  createExportTool as AgentToolDefinition,
  getExportTool as AgentToolDefinition,
];
