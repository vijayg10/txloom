import type { SimulationSpec, ValidationResult } from "./types.js";
import { ajvValidate } from "./ajv-validate.js";
import { ALL_INVARIANTS } from "./invariants/index.js";

export * from "./types.js";
export * from "./json-pointer.js";
export * from "./diff.js";
export { ALL_INVARIANTS } from "./invariants/index.js";
export { ajvValidate, schema } from "./ajv-validate.js";

/**
 * The one located-violation validation entry point shared by the editor (via API
 * round-trip), the REST API, and the MCP `validate_spec` tool (FR-004/010, D12).
 *
 * Structural (Ajv) errors run first; if the document doesn't even match the shape
 * semantic invariants expect, invariants are skipped rather than throwing on
 * missing/malformed fields.
 */
export function validateSpec(spec: unknown): ValidationResult {
  const structuralViolations = ajvValidate(spec);
  if (structuralViolations.length > 0) {
    return { valid: false, violations: structuralViolations };
  }

  const semanticViolations = ALL_INVARIANTS.flatMap(({ fn }) => fn(spec as SimulationSpec));
  const hasBlockingViolation = semanticViolations.some((v) => (v.severity ?? "error") === "error");

  return { valid: !hasBlockingViolation, violations: semanticViolations };
}
