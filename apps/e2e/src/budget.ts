import path from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";
import { REPO_ROOT } from "./compose.js";

const MARKER_PATH = path.join(REPO_ROOT, "apps/e2e/.budget-start.json");

/** FR-010: under 5 minutes end to end (provisioning + all stories + teardown)
 * on CI with a warm Docker layer cache; contracts/suite-interface.md's
 * 10-minute job timeout is the hard stop for a cold cache, so this assertion
 * only runs in CI (gated on the CI env var) — local runs vary too much by
 * machine/cache state to hold to the same number. */
export const BUDGET_MS = 5 * 60 * 1000;

export async function markBudgetStart(): Promise<void> {
  await writeFile(MARKER_PATH, JSON.stringify({ startedAt: Date.now() }));
}

/** Reads the start marker, deletes it, and throws if CI is set and the
 * elapsed time exceeded the budget — called from global-teardown after
 * `down -v` so the check covers the true end-to-end window. */
export async function checkBudgetAndCleanup(): Promise<void> {
  let startedAt: number | null = null;
  try {
    const raw = await readFile(MARKER_PATH, "utf-8");
    startedAt = (JSON.parse(raw) as { startedAt: number }).startedAt;
  } catch {
    startedAt = null;
  } finally {
    await rm(MARKER_PATH, { force: true });
  }

  if (!process.env.CI || startedAt === null) return;

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > BUDGET_MS) {
    throw new Error(
      `e2e suite exceeded its ${BUDGET_MS / 1000}s warm-cache budget (FR-010/SC-002): took ${Math.round(elapsedMs / 1000)}s end to end (provisioning + stories + teardown).`,
    );
  }
}
