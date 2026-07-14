import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { createScenarioTool, saveSpecVersionTool } from "@txloom/agent-tools";
import { injectJson, toolResult } from "../inject-json.js";

export function registerScenarioTools(server: McpServer, app: FastifyInstance): void {
  server.registerTool(
    createScenarioTool.name,
    { description: createScenarioTool.description, inputSchema: createScenarioTool.inputSchema },
    async (args) =>
      toolResult(
        (await injectJson(app, { method: "POST", url: "/api/v1/scenarios", payload: args })).body,
      ),
  );

  server.registerTool(
    saveSpecVersionTool.name,
    { description: saveSpecVersionTool.description, inputSchema: saveSpecVersionTool.inputSchema },
    async ({ scenario_id, spec }) =>
      toolResult(
        (
          await injectJson(app, {
            method: "POST",
            url: `/api/v1/scenarios/${scenario_id}/versions`,
            payload: { spec },
          })
        ).body,
      ),
  );
}
