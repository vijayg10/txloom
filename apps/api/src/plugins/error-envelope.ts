import type { FastifyInstance, FastifyError } from "fastify";
import fp from "fastify-plugin";

export interface ErrorEnvelopeBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Every non-2xx response uses one shape (contracts/api.md § Error envelope). */
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

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: { code: "not_found", message: "Route not found" },
    } satisfies ErrorEnvelopeBody);
  });
});
