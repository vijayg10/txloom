import type { FastifyInstance, FastifyError } from "fastify";
import fp from "fastify-plugin";

export interface ErrorEnvelopeBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Every non-2xx response uses one shape (contracts/api.md § Error envelope).
 * The not-found handler lives in app.ts, not here — Fastify only allows one
 * setNotFoundHandler() per instance, and app.ts needs to serve the SPA's
 * index.html for non-API routes when the built SPA is present. */
export default fp(async function errorEnvelope(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const code = error.code ?? (statusCode >= 500 ? "internal_error" : "bad_request");
    const body: ErrorEnvelopeBody = {
      error: {
        code,
        message: error.message,
        ...(error.validation ? { details: { violations: error.validation } } : {}),
      },
    };
    reply.status(statusCode).send(body);
  });
});
