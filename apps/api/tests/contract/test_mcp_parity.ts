import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ALL_AGENT_TOOLS } from "@txloom/agent-tools";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";

/** Every packages/agent-tools tool must map 1:1 onto its REST endpoint
 * response shape (FR-008/012). This suite exercises the DB-free tools
 * end-to-end through a real MCP client; DB-backed tools are covered by the
 * full-loop integration test (mcp-loop.test.ts) instead. */
describe("MCP tool ↔ REST parity", () => {
  let app: FastifyInstance;
  let client: Client;

  beforeAll(async () => {
    app = await buildApp({ skipDb: true });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address !== "object" || address === null) throw new Error("no server address");
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
    );
    client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    await app?.close();
  });

  it("registers every tool defined in packages/agent-tools", async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(ALL_AGENT_TOOLS.map((t) => t.name).sort());
  });

  it("get_spec_schema matches GET /spec/schema", async () => {
    const toolResult = await client.callTool({ name: "get_spec_schema", arguments: {} });
    const toolBody = JSON.parse((toolResult.content as { text: string }[])[0]!.text);

    const restResponse = await app.inject({ method: "GET", url: "/api/v1/spec/schema" });
    expect(toolBody).toEqual(restResponse.json());
  });

  it("get_authoring_docs matches GET /spec/docs", async () => {
    const toolResult = await client.callTool({ name: "get_authoring_docs", arguments: {} });
    const toolBody = JSON.parse((toolResult.content as { text: string }[])[0]!.text);

    const restResponse = await app.inject({ method: "GET", url: "/api/v1/spec/docs" });
    expect(toolBody).toEqual(restResponse.json());
  });

  it("validate_spec matches POST /spec/validate for both a valid and an invalid spec", async () => {
    for (const spec of [{ seed: 1 }, {}]) {
      const toolResult = await client.callTool({ name: "validate_spec", arguments: { spec } });
      const toolBody = JSON.parse((toolResult.content as { text: string }[])[0]!.text);

      const restResponse = await app.inject({
        method: "POST",
        url: "/api/v1/spec/validate",
        payload: spec,
      });
      expect(toolBody).toEqual(restResponse.json());
    }
  });
});
