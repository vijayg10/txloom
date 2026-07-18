import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** apps/e2e/src -> repo root. */
export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const COMPOSE_PROJECT = "txloom-e2e";

const BASE_ARGS = [
  "compose",
  "-p",
  COMPOSE_PROJECT,
  "-f",
  "docker-compose.yml",
  "-f",
  "apps/e2e/compose.e2e.yml",
  "--profile",
  "demo-brokers",
];

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], opts: { capture?: boolean } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: REPO_ROOT,
      stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** `up -d --build --wait` — throws with stderr on failure so the caller can attach diagnostics. */
export async function composeUp(): Promise<void> {
  const result = await run([...BASE_ARGS, "up", "-d", "--build", "--wait"], { capture: true });
  if (result.code !== 0) {
    throw new Error(
      `docker compose up failed (exit ${result.code}):\n${result.stderr || result.stdout}`,
    );
  }
}

export async function composeDown(): Promise<void> {
  await run([...BASE_ARGS, "down", "-v"], { capture: true });
}

interface ComposePsEntry {
  Service: string;
  State: string;
  Health?: string;
}

export async function composePs(): Promise<ComposePsEntry[]> {
  const result = await run([...BASE_ARGS, "ps", "--all", "--format", "json"], { capture: true });
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ComposePsEntry);
}

export async function composeLogs(service: string): Promise<string> {
  const result = await run([...BASE_ARGS, "logs", "--no-color", "--tail", "200", service], {
    capture: true,
  });
  return result.stdout + result.stderr;
}

/** All services' logs in one blob — captured before teardown so CI can
 * upload it alongside the Playwright report on any failure (FR-013, R9). */
export async function composeLogsAll(): Promise<string> {
  const result = await run([...BASE_ARGS, "logs", "--no-color"], { capture: true });
  return result.stdout + result.stderr;
}

/** Services that never reported healthy/running — used to build a precise
 * startup-failure message (spec edge case: a component fails to start). */
export async function unhealthyServices(): Promise<string[]> {
  const entries = await composePs();
  return entries
    .filter((entry) => {
      if (entry.Health) return entry.Health !== "healthy";
      return entry.State !== "running";
    })
    .map((entry) => entry.Service);
}
