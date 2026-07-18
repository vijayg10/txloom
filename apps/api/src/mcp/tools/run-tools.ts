import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import {
  launchRunTool,
  getRunStatusTool,
  getRealismReportTool,
  startStreamTool,
  stopStreamTool,
} from "@txloom/agent-tools";
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

  server.registerTool(
    startStreamTool.name,
    { description: startStreamTool.description, inputSchema: startStreamTool.inputSchema },
    async ({ run_id, target_tps, sink, label_channel_enabled }) => {
      const payload: Record<string, unknown> = { sink };
      if (target_tps !== undefined) payload.target_tps = target_tps;
      if (label_channel_enabled !== undefined)
        payload.label_channel_enabled = label_channel_enabled;
      return toolResult(
        (
          await injectJson(app, {
            method: "POST",
            url: `/api/v1/runs/${run_id}/stream/start`,
            payload,
          })
        ).body,
      );
    },
  );

  server.registerTool(
    stopStreamTool.name,
    { description: stopStreamTool.description, inputSchema: stopStreamTool.inputSchema },
    async ({ run_id }) =>
      toolResult(
        (await injectJson(app, { method: "POST", url: `/api/v1/runs/${run_id}/stream/stop` })).body,
      ),
  );
}
