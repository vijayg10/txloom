import { validateSpec, type ValidationResult } from "@txloom/spec";

/** The `400 spec_invalid` body for a stored spec that no longer validates — a rollback target,
 * a template, or a scenario's current version can all go stale as the invariants evolve. */
export function specInvalidError(subject: string, result: ValidationResult) {
  return {
    error: {
      code: "spec_invalid",
      message: `${subject} no longer passes validation: fix the violations below and save a new version.`,
      details: { violations: result.violations },
    },
  };
}

/** Returns the error body when `spec` fails validation, else null. */
export function checkStoredSpec(subject: string, spec: unknown) {
  const result = validateSpec(spec);
  return result.valid ? null : specInvalidError(subject, result);
}
