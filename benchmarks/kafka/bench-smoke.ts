import { readFile } from "node:fs/promises";
import path from "node:path";
import { runBenchmark } from "./lib.js";

interface SmokeBaseline {
  target_tps: number;
  duration_s: number;
  min_achieved_tps: number;
}

/**
 * CI-scale variant of the Kafka benchmark (D8, constitution Principle V §
 * Development Workflow Gate 4): a much smaller target/duration than the
 * published 1,000 TPS number, fast enough to run every PR, that fails the
 * build if achieved throughput regresses below `baseline-smoke.json`'s
 * `min_achieved_tps` threshold. Requires a reachable Kafka broker
 * (KAFKA_BROKERS) — wire a `demo-brokers` Kafka container into CI to run
 * this as part of `pnpm bench:smoke`.
 */
async function main() {
  const baselinePath = path.join(import.meta.dirname, "baseline-smoke.json");
  const baseline = JSON.parse(await readFile(baselinePath, "utf-8")) as SmokeBaseline;
  const brokers = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");

  console.log(
    `Running Kafka smoke benchmark: target ${baseline.target_tps} TPS for ${baseline.duration_s}s (regression threshold: ${baseline.min_achieved_tps} TPS)...`,
  );
  const result = await runBenchmark({
    targetTps: baseline.target_tps,
    durationMs: baseline.duration_s * 1000,
    brokers,
    topic: "txloom-bench-smoke",
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.achieved_tps < baseline.min_achieved_tps) {
    console.error(
      `Regression: achieved ${result.achieved_tps.toFixed(1)} TPS, below the ${baseline.min_achieved_tps} TPS threshold in ${path.basename(baselinePath)}.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `OK: achieved ${result.achieved_tps.toFixed(1)} TPS >= ${baseline.min_achieved_tps} TPS threshold.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
