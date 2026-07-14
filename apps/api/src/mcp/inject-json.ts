import type { FastifyInstance, InjectOptions } from "fastify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface InjectJsonOptions {
  method: string;
  url: string;
  /** Any JSON-serializable value — MCP tool args arrive as `unknown` from the
   * SDK's runtime-validated-but-statically-loose zod inference. */
  payload?: unknown;
}

/** Calls a REST route in-process via Fastify's `inject()` — the mechanism that
 * makes every MCP tool a literal 1:1 wrapper over the same REST endpoint the
 * web UI and CLI hit, rather than a parallel reimplementation (FR-008/012,
 * contracts/api.md § Contract invariants). */
export async function injectJson(
  app: FastifyInstance,
  opts: InjectJsonOptions,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject(opts as InjectOptions);
  return { statusCode: response.statusCode, body: response.json() };
}

export function toolResult(body: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}
