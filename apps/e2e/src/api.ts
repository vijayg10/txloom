/** Direct REST helpers for e2e setup that has no MCP tool — connections are created through
 * the UI or the REST surface, never the agent toolset (they hold credentials). */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export async function createWebhookConnection(name: string, url: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/v1/connections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "webhook", name, config: { url } }),
  });
  if (!response.ok) {
    throw new Error(`create connection failed (${response.status}): ${await response.text()}`);
  }
  return ((await response.json()) as { id: string }).id;
}
