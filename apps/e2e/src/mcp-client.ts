import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface McpInvariantViolation {
  path: string;
  code: string;
  message: string;
  severity?: "error" | "warning";
}

export interface McpValidationResult {
  valid: boolean;
  violations: McpInvariantViolation[];
}

export interface McpScenario {
  id: string;
  name: string;
  currency: string;
  current_version_id: string | null;
}

export interface McpRun {
  id: string;
  scenario_id: string;
  status: string;
  seed: string;
}

export interface McpRealismReport {
  event_count: number;
  amount: { mean: number; stddev: number; min: number; max: number };
  inter_arrival_ms: { mean: number; stddev: number };
  fraud: { achieved_rate: number; by_typology: Record<string, number> };
  benchmark_comparison: Record<string, unknown> | null;
}

export interface McpExportManifest {
  export_id: string;
  run_id: string;
  format: string;
  file_name: string;
  answer_key_file_name: string | null;
}

export interface McpTruthEvent {
  event_id: string;
  ts: string;
  type: string;
  status: string;
  amount: number;
  label: { typology: string | null; actor_id: string | null } | null;
  [key: string]: unknown;
}

export interface McpTruthEventsPage {
  events: McpTruthEvent[];
  next_cursor: string | null;
}

function firstTextBlock(result: CallToolResult): string {
  const block = result.content.find(
    (entry): entry is { type: "text"; text: string } => entry.type === "text",
  );
  if (!block) throw new Error("MCP tool result had no text content block");
  return block.text;
}

function parseToolResult<T>(result: CallToolResult): T {
  if (result.isError) {
    throw new Error(`MCP tool call failed: ${firstTextBlock(result)}`);
  }
  return JSON.parse(firstTextBlock(result)) as T;
}

/** Typed client over the product's `/mcp` streamable-HTTP endpoint (research.md
 * R6) — every method maps 1:1 onto a registered tool, exactly as an external
 * MCP-capable agent would call it (contracts/suite-interface.md). */
export class TxLoomMcpClient {
  private readonly client: Client;
  private connected = false;

  constructor(private readonly url: string = "http://localhost:3000/mcp") {
    this.client = new Client({ name: "txloom-e2e", version: "0.1.0" });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const transport = new StreamableHTTPClientTransport(new URL(this.url));
    // Same upstream typing gap noted in apps/api/src/mcp/server.ts: the SDK's
    // sessionId accessor doesn't satisfy Transport under exactOptionalPropertyTypes.
    await this.client.connect(transport as Transport);
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  private async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  }

  async validateSpec(spec: unknown): Promise<McpValidationResult> {
    return parseToolResult(await this.call("validate_spec", { spec }));
  }

  async createScenario(input: {
    name: string;
    currency: string;
    description?: string;
    template_slug?: string;
  }): Promise<McpScenario> {
    return parseToolResult(await this.call("create_scenario", input));
  }

  async saveSpecVersion(scenarioId: string, spec: unknown): Promise<unknown> {
    return parseToolResult(await this.call("save_spec_version", { scenario_id: scenarioId, spec }));
  }

  async launchRun(
    scenarioId: string,
    opts: { seed?: number; mode?: "batch" | "batch_then_stream" } = {},
  ): Promise<McpRun> {
    return parseToolResult(await this.call("launch_run", { scenario_id: scenarioId, ...opts }));
  }

  async getRunStatus(runId: string): Promise<McpRun> {
    return parseToolResult(await this.call("get_run_status", { run_id: runId }));
  }

  async getRealismReport(runId: string): Promise<McpRealismReport> {
    return parseToolResult(await this.call("get_realism_report", { run_id: runId }));
  }

  async createExport(
    runId: string,
    format: "csv" | "parquet" | "json",
    opts: { include_labels?: boolean; acknowledged_warning?: boolean } = {},
  ): Promise<McpExportManifest> {
    return parseToolResult(await this.call("create_export", { run_id: runId, format, ...opts }));
  }

  async getExport(runId: string, exportId: string): Promise<McpExportManifest> {
    return parseToolResult(await this.call("get_export", { run_id: runId, export_id: exportId }));
  }

  async getTruthEvents(
    runId: string,
    opts: { typology?: string; actor_id?: string; status?: string; limit?: number } = {},
  ): Promise<McpTruthEventsPage> {
    return parseToolResult(await this.call("get_truth_events", { run_id: runId, ...opts }));
  }

  async startStream(
    runId: string,
    sink:
      | { type: "kafka"; config: { brokers: string[]; topic: string } }
      | { type: "rabbitmq"; config: { url: string; exchange: string; routingKey: string } }
      | { type: "webhook"; config: { url: string } },
    opts: { target_tps?: number; label_channel_enabled?: boolean } = {},
  ): Promise<unknown> {
    return parseToolResult(await this.call("start_stream", { run_id: runId, sink, ...opts }));
  }

  async stopStream(runId: string): Promise<unknown> {
    return parseToolResult(await this.call("stop_stream", { run_id: runId }));
  }
}
