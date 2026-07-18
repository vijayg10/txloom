import { spawn } from "node:child_process";
import path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { composeDown, composeLogsAll, REPO_ROOT } from "./compose.js";
import { checkBudgetAndCleanup } from "./budget.js";

/** `docker run --rm alpine rm -rf` as a fallback when the host user can't
 * remove files a container wrote as root (typical on Linux CI). */
function scrubViaContainer(dataDir: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      ["run", "--rm", "-v", `${dataDir}:/scrub`, "alpine:3", "sh", "-c", "rm -rf /scrub/*"],
      { stdio: "ignore" },
    );
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

/** `down -v` plus a scrub of the host `./data` bind mount so no state survives
 * a suite execution (FR-011); `E2E_KEEP_STACK=1` skips both for debugging. */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_STACK === "1") {
    console.warn("E2E_KEEP_STACK=1 set — leaving the txloom-e2e stack running.");
    return;
  }

  // Captured unconditionally (cheap) so CI can upload it alongside the
  // Playwright report on any failure without needing to know in advance
  // whether this run passed (FR-013, research.md R9).
  await writeFile(
    path.join(REPO_ROOT, "apps/e2e/compose-logs.txt"),
    await composeLogsAll().catch((error) => `(failed to capture compose logs: ${error})`),
  );

  await composeDown();

  const dataDir = path.join(REPO_ROOT, "data");
  try {
    await rm(dataDir, { recursive: true, force: true });
  } catch {
    await scrubViaContainer(dataDir);
  }

  // Runs last so the check covers the true end-to-end window (provisioning +
  // stories + teardown, FR-010) and cleanup above always happens regardless.
  await checkBudgetAndCleanup();
}
