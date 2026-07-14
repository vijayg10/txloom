import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { validateSpecTool } from "@txloom/agent-tools";
import { injectJson, toolResult } from "../inject-json.js";

/** Reuses the located-violation model verbatim — the same shape the Monaco
 * editor renders (FR-010). */
export function registerValidateSpecTool(server: McpServer, app: FastifyInstance): void {
  server.registerTool(
    validateSpecTool.name,
    { description: validateSpecTool.description, inputSchema: validateSpecTool.inputSchema },
    async ({ spec }) =>
      toolResult(
        (await injectJson(app, { method: "POST", url: "/api/v1/spec/validate", payload: spec }))
          .body,
      ),
  );
}
