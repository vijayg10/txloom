import Ajv2020 from "ajv/dist/2020.js";
import { kafkaSinkFactory, rabbitMqSinkFactory, webhookSinkFactory } from "@txloom/sinks";
import { addressWarnings, type ConnectionWarning } from "@txloom/spec";

// `useDefaults` fills schema defaults (a webhook's timeout_ms and max_attempts, say) into the
// validated config in place, so a connection created over REST with only a URL is stored with
// every setting the sinks read.
const ajv = new Ajv2020({ allErrors: true, strict: true, useDefaults: true });

const FACTORIES = {
  kafka: kafkaSinkFactory,
  rabbitmq: rabbitMqSinkFactory,
  webhook: webhookSinkFactory,
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface ConnectionViolation {
  path: string;
  code: string;
  message: string;
}

export interface ConnectionBody {
  type?: "kafka" | "rabbitmq" | "webhook";
  name?: string;
  config?: unknown;
  secrets?: unknown;
}

/** Validates a connection body against its typed per-type `configSchema`/`secretsSchema`
 * (FR-007, data-model.md §1.1.1–1.1.2), returning located violations in the same shape
 * `validate_spec` uses. `requireAll` controls whether `type`/`name`/`config` must all be
 * present (POST) or may be partial (PATCH). */
export function validateConnectionBody(
  body: ConnectionBody,
  requireAll: boolean,
): ConnectionViolation[] {
  const violations: ConnectionViolation[] = [];

  if (requireAll && !body.type) {
    violations.push({ path: "/type", code: "required", message: "/type is required" });
  }
  if (body.type && !(body.type in FACTORIES)) {
    violations.push({
      path: "/type",
      code: "enum",
      message: `/type must be one of kafka, rabbitmq, webhook`,
    });
  }
  if (requireAll && body.name === undefined) {
    violations.push({ path: "/name", code: "required", message: "/name is required" });
  }
  if (body.name !== undefined && !NAME_RE.test(body.name)) {
    violations.push({
      path: "/name",
      code: "pattern",
      message: `/name must match ^[a-z0-9][a-z0-9-]{0,62}$`,
    });
  }

  if (!body.type || !(body.type in FACTORIES)) return violations;
  const factory = FACTORIES[body.type];

  if (body.config !== undefined || requireAll) {
    const validateConfig = ajv.compile(factory.configSchema);
    if (!validateConfig(body.config ?? {})) {
      for (const error of validateConfig.errors ?? []) {
        violations.push({
          path: `/config${error.instancePath}`,
          code: `schema:${error.keyword}`,
          message: `/config${error.instancePath} ${error.message ?? "is invalid"}`.trim(),
        });
      }
    }
  }

  if (body.secrets !== undefined && body.secrets !== null && factory.secretsSchema) {
    const validateSecrets = ajv.compile(factory.secretsSchema);
    if (!validateSecrets(body.secrets)) {
      for (const error of validateSecrets.errors ?? []) {
        violations.push({
          path: `/secrets${error.instancePath}`,
          code: `schema:${error.keyword}`,
          message: `/secrets${error.instancePath} ${error.message ?? "is invalid"}`.trim(),
        });
      }
    }
  }

  return violations;
}

export function connectionWarnings(
  type: "kafka" | "rabbitmq" | "webhook",
  config: Record<string, unknown>,
): ConnectionWarning[] {
  return addressWarnings(type, config);
}
