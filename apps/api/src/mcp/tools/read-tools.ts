import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { getSpecSchemaTool, getAuthoringDocsTool, listTemplatesTool } from "@txloom/agent-tools";
import { injectJson, toolResult } from "../inject-json.js";

export function registerReadTools(server: McpServer, app: FastifyInstance): void {
  server.registerTool(
    getSpecSchemaTool.name,
    { description: getSpecSchemaTool.description, inputSchema: getSpecSchemaTool.inputSchema },
    async () =>
      toolResult((await injectJson(app, { method: "GET", url: "/api/v1/spec/schema" })).body),
  );

  server.registerTool(
    getAuthoringDocsTool.name,
    {
      description: getAuthoringDocsTool.description,
      inputSchema: getAuthoringDocsTool.inputSchema,
    },
    async () =>
      toolResult((await injectJson(app, { method: "GET", url: "/api/v1/spec/docs" })).body),
  );

  server.registerTool(
    listTemplatesTool.name,
    { description: listTemplatesTool.description, inputSchema: listTemplatesTool.inputSchema },
    async () =>
      toolResult((await injectJson(app, { method: "GET", url: "/api/v1/templates" })).body),
  );
}
