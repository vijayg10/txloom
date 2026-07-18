import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import {
  getSpecSchemaTool,
  getAuthoringDocsTool,
  listTemplatesTool,
  getTruthEventsTool,
} from "@txloom/agent-tools";
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

  server.registerTool(
    getTruthEventsTool.name,
    { description: getTruthEventsTool.description, inputSchema: getTruthEventsTool.inputSchema },
    async ({ run_id, typology, actor_id, status, cursor, limit }) => {
      const query = new URLSearchParams();
      if (typology !== undefined) query.set("typology", typology);
      if (actor_id !== undefined) query.set("actor_id", actor_id);
      if (status !== undefined) query.set("status", status);
      if (cursor !== undefined) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      const qs = query.toString();
      return toolResult(
        (
          await injectJson(app, {
            method: "GET",
            url: `/api/v1/runs/${run_id}/truth/events${qs ? `?${qs}` : ""}`,
          })
        ).body,
      );
    },
  );
}
