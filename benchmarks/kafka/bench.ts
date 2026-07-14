import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runBenchmark } from "./lib.js";

/**
 * The published v1 benchmark (FR-041, D8, constitution Principle V):
 * sustained 1,000 events/sec delivered to Kafka with flat memory. Requires a
 * reachable Kafka broker — point KAFKA_BROKERS at one (the compose
 * `demo-brokers` profile works: `docker compose --profile demo-brokers up kafka`,
 * then `KAFKA_BROKERS=localhost:9092 pnpm bench:kafka`).
 *
 * Prints the result and writes benchmarks/kafka/results.json — the numbers
 * README.md publishes come from this file.
 */
async function main() {
  const targetTps = Number(process.env.BENCH_TARGET_TPS ?? 1000);
  const durationMs = Number(process.env.BENCH_DURATION_MS ?? 60_000);
  const brokers = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");

  console.log(`Running Kafka benchmark: target ${targetTps} TPS for ${durationMs / 1000}s...`);
  const result = await runBenchmark({ targetTps, durationMs, brokers, topic: "txloom-bench" });

  console.log(JSON.stringify(result, null, 2));
  const outPath = path.join(import.meta.dirname, "results.json");
  await writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(`wrote ${outPath}`);

  if (result.achieved_tps < targetTps * 0.95) {
    console.error(
      `Achieved TPS (${result.achieved_tps.toFixed(1)}) fell more than 5% below target (${targetTps}).`,
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
