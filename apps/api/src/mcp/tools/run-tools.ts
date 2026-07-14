import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { launchRunTool, getRunStatusTool, getRealismReportTool } from "@txloom/agent-tools";
import { injectJson, toolResult } from "../inject-json.js";

export function registerRunTools(server: McpServer, app: FastifyInstance): void {
  server.registerTool(
    launchRunTool.name,
    { description: launchRunTool.description, inputSchema: launchRunTool.inputSchema },
    async ({ scenario_id, seed, mode }) => {
      const payload: Record<string, unknown> = {};
      if (seed !== undefined) payload.seed = seed;
      if (mode !== undefined) payload.mode = mode;
      return toolResult(
        (
          await injectJson(app, {
            method: "POST",
            url: `/api/v1/scenarios/${scenario_id}/runs`,
            payload,
          })
        ).body,
      );
    },
  );

  server.registerTool(
    getRunStatusTool.name,
    { description: getRunStatusTool.description, inputSchema: getRunStatusTool.inputSchema },
    async ({ run_id }) =>
      toolResult((await injectJson(app, { method: "GET", url: `/api/v1/runs/${run_id}` })).body),
  );

  server.registerTool(
    getRealismReportTool.name,
    {
      description: getRealismReportTool.description,
      inputSchema: getRealismReportTool.inputSchema,
    },
    async ({ run_id }) =>
      toolResult(
        (await injectJson(app, { method: "GET", url: `/api/v1/runs/${run_id}/report` })).body,
      ),
  );
}
