import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import {
  DockerComposeEnvironment,
  Wait,
  type StartedDockerComposeEnvironment,
} from "testcontainers";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const TIME_BUDGET_MS = 10 * 60 * 1000; // SC-003: running studio in under 10 minutes.

// Drives the actual documented install command — `docker compose up` against
// the repo-root docker-compose.yml, no profile flags — and confirms the api
// service reaches a healthy GET /health within the quickstart's documented
// time budget (SC-003). Run via `pnpm test:integration` (requires Docker and
// builds the api/worker images, so this is the slowest test in the suite).
describe("fresh install reaches a healthy studio (SC-003)", () => {
  let environment: StartedDockerComposeEnvironment | undefined;

  afterAll(async () => {
    await environment?.down({ timeout: 30_000 });
  });

  it(
    "docker compose up brings the api service to a healthy GET /health",
    async () => {
      const startedAt = Date.now();

      environment = await new DockerComposeEnvironment(REPO_ROOT, "docker-compose.yml")
        .withBuild()
        .withWaitStrategy("api", Wait.forHttp("/api/v1/health", 3000).forStatusCode(200))
        .withStartupTimeout(TIME_BUDGET_MS)
        .up(["api", "mysql", "redis", "worker"]);

      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeLessThan(TIME_BUDGET_MS);

      const api = environment.getContainer("api");
      const response = await fetch(
        `http://${api.getHost()}:${api.getMappedPort(3000)}/api/v1/health`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });
    },
    TIME_BUDGET_MS + 60_000,
  );
});
