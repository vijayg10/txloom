import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { InvariantViolation } from "./types.js";
import schemaJson from "./schema.json" with { type: "json" };

/** The raw JSON Schema 2020-12 document — exported for consumers (Fastify body
 * validation, Monaco autocomplete, GET /spec/schema) that need the schema itself. */
export const schema = schemaJson;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateFn = ajv.compile(schema);

/** Structural validation only (JSON Schema 2020-12) — semantic invariants live in
 * ./invariants and run separately (D12). Returns the same located-violation shape. */
export function ajvValidate(spec: unknown): InvariantViolation[] {
  const valid = validateFn(spec);
  if (valid) return [];

  return (validateFn.errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    code: `schema:${error.keyword}`,
    message: `${error.instancePath || "(root)"} ${error.message ?? "is invalid"}`.trim(),
  }));
}
