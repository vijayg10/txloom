/** Connections & settings: agent-integration connection details — point any
 * MCP-capable agent (Claude Code, Cursor, any MCP client) at this studio's
 * `/mcp` endpoint. No embedded LLM ships in the product (D13); this panel is
 * how users bring their own. */
export function AgentConnectionPanel() {
  const mcpUrl = `${window.location.origin}/mcp`;
  const docsUrl = `${window.location.origin}/api/v1/spec/docs`;

  return (
    <section className="agent-connection">
      <h2>Agent integration</h2>
      <p>
        Point any MCP-capable AI agent at this address and describe the scenario you want in plain
        English.
      </p>
      <dl>
        <dt>MCP server address</dt>
        <dd>
          <code>{mcpUrl}</code>
        </dd>
        <dt>Authoring docs (schema reference, invariant catalog, worked examples)</dt>
        <dd>
          <a href={docsUrl}>{docsUrl}</a>
        </dd>
      </dl>
    </section>
  );
}
