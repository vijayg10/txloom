import { fail, referenceSpec, scratchDir } from "./lib.js";
import runPartition from "../../apps/worker/src/pool/partition-worker.js";

const MAX_GROWTH = 0.1; // SC-007: 30 → 90 days may grow peak heap by at most 10%

/**
 * Generation memory must not grow with run length (constitution Principle V). Generates the same
 * population for 30 and for 90 days through the real partition worker and compares the peak
 * heap each sampled at a day boundary. Run with `node --expose-gc` (the package script does) so
 * the samples measure live data rather than not-yet-collected garbage.
 */
async function main() {
  if (typeof (globalThis as { gc?: unknown }).gc !== "function") {
    fail("Run with --expose-gc: NODE_OPTIONS=--expose-gc pnpm bench:memory-flatness");
  }
  const consumers = Number(process.env.BENCH_CONSUMERS ?? 20_000);
  const peaks: Record<number, number> = {};

  for (const days of [30, 90]) {
    const result = await runPartition({
      spec: referenceSpec({ consumers, days }),
      seed: "1",
      partitionNo: 0,
      partitionCount: 1,
      engineVersion: (await import("@txloom/engine")).ENGINE_VERSION,
      runId: `flatness-${days}`,
      dataDir: await scratchDir(),
    });
    peaks[days] = result.peakHeapBytes;
    console.log(`${days} days: peak heap ${(result.peakHeapBytes / 1024 ** 2).toFixed(1)} MiB`);
  }

  const growth = peaks[90]! / peaks[30]! - 1;
  console.log(`growth 30 → 90 days: ${(growth * 100).toFixed(1)}%`);
  if (growth > MAX_GROWTH) {
    fail(
      `Peak heap grew ${(growth * 100).toFixed(1)}%, above the ${MAX_GROWTH * 100}% limit (SC-007).`,
    );
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
