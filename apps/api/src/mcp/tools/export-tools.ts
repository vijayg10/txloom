import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { createExportTool, getExportTool } from "@txloom/agent-tools";
import { injectJson, toolResult } from "../inject-json.js";

export function registerExportTools(server: McpServer, app: FastifyInstance): void {
  server.registerTool(
    createExportTool.name,
    { description: createExportTool.description, inputSchema: createExportTool.inputSchema },
    async ({ run_id, format, include_labels, acknowledged_warning }) => {
      const payload: Record<string, unknown> = { format };
      if (include_labels !== undefined) payload.include_labels = include_labels;
      if (acknowledged_warning !== undefined) payload.acknowledged_warning = acknowledged_warning;
      return toolResult(
        (await injectJson(app, { method: "POST", url: `/api/v1/runs/${run_id}/exports`, payload }))
          .body,
      );
    },
  );

  server.registerTool(
    getExportTool.name,
    { description: getExportTool.description, inputSchema: getExportTool.inputSchema },
    async ({ run_id, export_id }) =>
      toolResult(
        (
          await injectJson(app, {
            method: "GET",
            url: `/api/v1/runs/${run_id}/exports/${export_id}`,
          })
        ).body,
      ),
  );
}
