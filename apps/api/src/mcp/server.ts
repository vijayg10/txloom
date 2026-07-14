import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FastifyInstance } from "fastify";
import { registerReadTools } from "./tools/read-tools.js";
import { registerValidateSpecTool } from "./tools/validate-spec.js";
import { registerScenarioTools } from "./tools/scenario-tools.js";
import { registerRunTools } from "./tools/run-tools.js";
import { registerExportTools } from "./tools/export-tools.js";

function createMcpServer(app: FastifyInstance): McpServer {
  const server = new McpServer({ name: "txloom", version: "0.1.0" });
  registerReadTools(server, app);
  registerValidateSpecTool(server, app);
  registerScenarioTools(server, app);
  registerRunTools(server, app);
  registerExportTools(server, app);
  return server;
}

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0" as const,
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

/**
 * MCP server mounted at `/mcp` (streamable-HTTP transport, stateless mode) —
 * every tool delegates to `app.inject()` against the exact REST routes the
 * web UI and CLI use, so 1:1 REST parity holds by construction (D13,
 * FR-008/012). A fresh McpServer + transport per request matches the SDK's
 * documented stateless pattern — no session store, no new service.
 */
export default async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mcp", async (request, reply) => {
    const mcpServer = createMcpServer(app);
    // Stateless mode: omitting sessionIdGenerator disables session tracking.
    const transport = new StreamableHTTPServerTransport({});
    reply.hijack();
    // The SDK's onclose/onerror accessor types don't quite satisfy the Transport
    // interface under exactOptionalPropertyTypes (an upstream typing gap, not a
    // runtime issue) — narrow cast, not a behavior change.
    await mcpServer.connect(transport as Transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    reply.raw.on("close", () => {
      void transport.close();
      void mcpServer.close();
    });
  });

  app.get("/mcp", async (_request, reply) => {
    reply.status(405).send(METHOD_NOT_ALLOWED);
  });

  app.delete("/mcp", async (_request, reply) => {
    reply.status(405).send(METHOD_NOT_ALLOWED);
  });
}
