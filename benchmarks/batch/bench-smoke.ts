import { readFile } from "node:fs/promises";
import path from "node:path";
import { fail, referenceSpec, runThroughApi, writeResult } from "./lib.js";

interface Baseline {
  consumers: number;
  days: number;
  /** Events per second recorded on the reference runner class. */
  events_per_second: number;
  /** Fail when throughput falls more than this fraction below the baseline. */
  max_regression: number;
}

/** CI-scale variant of the reference benchmark (20k consumers × 14 days, R18): fails when
 * generation throughput regresses more than 15% against `baseline-smoke.json`. */
async function main() {
  const baseline = JSON.parse(
    await readFile(path.join(import.meta.dirname, "baseline-smoke.json"), "utf-8"),
  ) as Baseline;
  const dataDir = process.env.DATA_DIR ?? "./data";

  const result = await runThroughApi(
    referenceSpec({ consumers: baseline.consumers, days: baseline.days, merchants: 1_000 }),
    dataDir,
    15 * 60 * 1000,
  );
  console.log(JSON.stringify(result, null, 2));
  if (process.env.BENCH_WRITE_RESULT) console.log(`Wrote ${await writeResult("smoke", result)}`);

  const floor = baseline.events_per_second * (1 - baseline.max_regression);
  if (result.events_per_second < floor) {
    fail(
      `Throughput ${result.events_per_second.toFixed(0)} events/s is more than ${baseline.max_regression * 100}% below the baseline ${baseline.events_per_second} (floor ${floor.toFixed(0)}).`,
    );
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
