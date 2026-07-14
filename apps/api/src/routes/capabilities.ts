import type { FastifyInstance } from "fastify";

export interface Capabilities {
  modules: {
    /** Optional in-process AI-assist plugin — always false in v1 (D13, FR-012). */
    ai_assist: boolean;
  };
}

/** GET /capabilities — optional-module discovery; the UI reveals a surface only
 * when this advertises it (FR-012). v1 ships no embedded LLM, so ai_assist is
 * always false; the shape exists so a future in-process AI-assist plugin can flip
 * it without a UI redeploy. */
export default async function capabilitiesRoutes(app: FastifyInstance) {
  app.get("/capabilities", async (): Promise<Capabilities> => ({
    modules: { ai_assist: false },
  }));
}
