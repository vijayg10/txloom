import { composeUp, composeLogs, unhealthyServices } from "./compose.js";
import { markBudgetStart } from "./budget.js";

/** Brings up the real shipped stack (project `txloom-e2e`, research.md R2) before
 * any spec runs. On failure, names the container that never became healthy and
 * dumps its logs (spec edge case: startup failure) instead of a bare timeout. */
export default async function globalSetup(): Promise<void> {
  await markBudgetStart();
  try {
    await composeUp();
  } catch (error) {
    const unhealthy = await unhealthyServices().catch(() => []);
    const diagnostics = await Promise.all(
      unhealthy.map(async (service) => `--- ${service} logs ---\n${await composeLogs(service)}`),
    );
    const detail = diagnostics.join("\n\n") || "(could not determine which service is unhealthy)";
    throw new Error(
      `e2e stack failed to become healthy. Unhealthy service(s): ${unhealthy.join(", ") || "unknown"}.\n\n${detail}\n\nOriginal error: ${(error as Error).message}`,
    );
  }
}
