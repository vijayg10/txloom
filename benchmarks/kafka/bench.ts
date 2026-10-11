import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runBenchmark } from "./lib.js";

/**
 * The published Kafka benchmark (SC-010, FR-041, constitution Principle V): a real stream session
 * at 1,000 TPS for 30 minutes, launched through the API with the reference spec (every typology and
 * imperfection). Passes when at least 99% of 1-second windows are within ±5% of the target and the
 * worker's memory stays flat.
 *
 * Needs the stack running (`docker compose --profile demo-brokers up`). `KAFKA_BROKERS` is the
 * broker address *as the worker sees it* (default `kafka:29092`); `TXLOOM_API_URL` is the API.
 * Writes benchmarks/kafka/results.json — the numbers README.md publishes come from it.
 */
async function main() {
  const targetTps = Number(process.env.BENCH_TARGET_TPS ?? 1000);
  const durationMs = Number(process.env.BENCH_DURATION_MS ?? 30 * 60_000);
  const brokers = (process.env.KAFKA_BROKERS ?? "kafka:29092").split(",");

  console.log(
    `Kafka benchmark: ${targetTps} TPS for ${durationMs / 60_000} min through the API...`,
  );
  const result = await runBenchmark({ targetTps, durationMs, brokers, topic: "txloom-bench" });

  console.log(
    JSON.stringify({ ...result, memory_rss_mb: undefined, achieved_windows: undefined }, null, 2),
  );
  const outPath = path.join(import.meta.dirname, "results.json");
  await writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(`wrote ${outPath}`);

  const failures: string[] = [];
  if (result.fraction_in_band < 0.99) {
    failures.push(
      `only ${(result.fraction_in_band * 100).toFixed(1)}% of windows were within ±5% of ${targetTps} TPS (need ≥ 99%)`,
    );
  }
  if (result.rss_growth > 0.1) {
    failures.push(`worker RSS grew ${(result.rss_growth * 100).toFixed(1)}% (need ≤ 10%)`);
  }
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
