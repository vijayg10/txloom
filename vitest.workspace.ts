import { fileURLToPath } from "node:url";
import { defineWorkspace } from "vitest/config";

// One workspace, four named projects. `pnpm test` runs unit+contract+component
// (fast, Docker-free); `pnpm test:integration` runs the `integration` project
// (Testcontainers: MySQL/Redis/Kafka/RabbitMQ) via `--project integration`.
export default defineWorkspace([
  {
    test: {
      name: "unit",
      environment: "node",
      include: ["packages/*/tests/**/*.test.ts", "apps/api/tests/eval/**/*.ts"],
      exclude: ["**/integration/**"],
    },
  },
  {
    test: {
      name: "contract",
      environment: "node",
      include: ["apps/api/tests/contract/test_*.ts"],
      // These spin up Testcontainers and belong to the `integration` project
      // below instead, so `pnpm test` stays fast and Docker-free.
      exclude: [
        "**/test_scenarios.ts",
        "**/test_runs.ts",
        "**/test_exports.ts",
        "**/test_run_control.ts",
        "**/test_inspector.ts",
        "**/test_ws_progress.ts",
        "**/test_stream.ts",
        "**/test_sinks.ts",
        "**/test_templates.ts",
        "**/test_settings.ts",
      ],
    },
  },
  {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      },
    },
    test: {
      name: "component",
      environment: "jsdom",
      include: ["apps/web/tests/**/*.test.tsx"],
      setupFiles: ["apps/web/tests/setup.ts"],
    },
  },
  {
    test: {
      name: "integration",
      environment: "node",
      include: [
        "apps/api/tests/integration/**/*.test.ts",
        "apps/api/tests/contract/test_scenarios.ts",
        "apps/api/tests/contract/test_runs.ts",
        "apps/api/tests/contract/test_exports.ts",
        "apps/api/tests/contract/test_run_control.ts",
        "apps/api/tests/contract/test_inspector.ts",
        "apps/api/tests/contract/test_ws_progress.ts",
        "apps/api/tests/contract/test_stream.ts",
        "apps/api/tests/contract/test_sinks.ts",
        "apps/api/tests/contract/test_templates.ts",
        "apps/api/tests/contract/test_settings.ts",
        "apps/worker/tests/integration/**/*.test.ts",
        "packages/sinks/tests/integration/**/*.test.ts",
        "benchmarks/smoke/**/*.test.ts",
      ],
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  },
]);
