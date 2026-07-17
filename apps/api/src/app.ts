import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import errorEnvelope from "./plugins/error-envelope.js";
import ajvPlugin from "./plugins/ajv.js";
import healthRoutes from "./routes/health.js";
import capabilitiesRoutes from "./routes/capabilities.js";
import specRoutes from "./routes/spec.js";
import specDocsRoutes from "./routes/spec-docs.js";
import scenarioRoutes from "./routes/scenarios.js";
import specVersionRoutes from "./routes/spec-versions.js";
import runsLaunchRoutes from "./routes/runs-launch.js";
import runsReadRoutes from "./routes/runs-read.js";
import runReportRoutes from "./routes/run-report.js";
import truthEventsRoutes from "./routes/truth-events.js";
import actorStoryRoutes from "./routes/actor-story.js";
import exportRoutes from "./routes/exports.js";
import templatesRoutes from "./routes/templates.js";
import sinksRoutes from "./routes/sinks.js";
import sinkTestRoutes from "./routes/sink-test.js";
import settingsRoutes from "./routes/settings.js";
import runControlRoutes from "./routes/run-control.js";
import runRegenerateRoutes from "./routes/run-regenerate.js";
import runOutputsRoutes from "./routes/run-outputs.js";
import inspectorRoutes from "./routes/inspector.js";
import runCompareRoutes from "./routes/run-compare.js";
import streamControlRoutes from "./routes/stream-control.js";
import wsRoutes from "./ws/index.js";
import mcpRoutes from "./mcp/server.js";

export interface BuildAppOptions {
  /** Skip DB-touching plugin registration — used by contract tests that only
   * exercise DB-free routes (health, capabilities) without a live MySQL. */
  skipDb?: boolean;
  logger?: boolean;
}

const API_PREFIX = "/api/v1";

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  // Plugin registration order: cross-cutting plugins first, then WS, then the
  // versioned REST route tree, then static SPA hosting last (T042).
  await app.register(errorEnvelope);
  await app.register(ajvPlugin);
  await app.register(fastifyWebsocket);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(capabilitiesRoutes);
      await api.register(specRoutes);
      await api.register(specDocsRoutes);

      if (!options.skipDb) {
        await api.register(scenarioRoutes);
        await api.register(specVersionRoutes);
        await api.register(runsLaunchRoutes);
        await api.register(runsReadRoutes);
        await api.register(runReportRoutes);
        await api.register(truthEventsRoutes);
        await api.register(actorStoryRoutes);
        await api.register(exportRoutes);
        await api.register(templatesRoutes);
        await api.register(sinksRoutes);
        await api.register(sinkTestRoutes);
        await api.register(settingsRoutes);
        await api.register(runControlRoutes);
        await api.register(runRegenerateRoutes);
        await api.register(runOutputsRoutes);
        await api.register(inspectorRoutes);
        await api.register(runCompareRoutes);
        await api.register(streamControlRoutes);
        await api.register(wsRoutes);
      }
    },
    { prefix: API_PREFIX },
  );

  // /mcp lives outside /api/v1 — one endpoint on the same process, not a new
  // service (contracts/api.md § MCP server, D13).
  await app.register(mcpRoutes);

  const spaDir = path.join(import.meta.dirname, "../../web/dist");
  const serveSpa = existsSync(spaDir);
  if (serveSpa) {
    await app.register(fastifyStatic, { root: spaDir });
  }

  // The one setNotFoundHandler() for this instance (Fastify allows only one):
  // API routes always get the JSON error envelope; other routes fall back to
  // the SPA's index.html when the built SPA is present (production/Docker).
  app.setNotFoundHandler((request, reply) => {
    if (!serveSpa || request.url.startsWith(API_PREFIX)) {
      reply.status(404).send({ error: { code: "not_found", message: "Route not found" } });
      return;
    }
    reply.sendFile("index.html");
  });

  return app;
}
