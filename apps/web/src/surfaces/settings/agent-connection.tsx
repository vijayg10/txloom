import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";

/** Connections & settings: agent-integration connection details — point any
 * MCP-capable agent (Claude Code, Cursor, any MCP client) at this studio's
 * `/mcp` endpoint. No embedded LLM ships in the product (D13); this panel is
 * how users bring their own. */
export function AgentConnectionPanel() {
  const mcpUrl = `${window.location.origin}/mcp`;
  const docsUrl = `${window.location.origin}/api/v1/spec/docs`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent integration</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="text-text-secondary mb-4">
          Point any MCP-capable AI agent at this address and describe the scenario you want in plain
          English.
        </p>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-text-secondary text-xs font-medium">MCP server address</dt>
            <dd className="mt-0.5">
              <code className="bg-hover text-text rounded-lg px-2 py-1 text-xs">{mcpUrl}</code>
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary text-xs font-medium">
              Authoring docs (schema reference, invariant catalog, worked examples)
            </dt>
            <dd className="mt-0.5">
              <a href={docsUrl} className="text-primary hover:underline">
                {docsUrl}
              </a>
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}
