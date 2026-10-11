import { fail, referenceSpec, runThroughApi, writeResult } from "./lib.js";

const WALL_LIMIT_SECONDS = 30 * 60; // SC-006
const THREAD_HEAP_LIMIT_BYTES = 1024 ** 3; // SC-007

/**
 * Reference-scale generation: 200k consumers × 90 days with every typology and imperfection,
 * launched through the API. Exits non-zero if it takes 30 minutes or more (SC-006) or any
 * generating thread's heap reaches 1 GB (SC-007). Needs a running stack (`docker compose up`)
 * and `DATA_DIR` pointing at the same data volume the worker writes to.
 */
async function main() {
  const dataDir = process.env.DATA_DIR ?? "./data";
  console.log("Launching the reference run (200k consumers × 90 days)…");
  const result = await runThroughApi(referenceSpec(), dataDir, WALL_LIMIT_SECONDS * 1000 * 2);
  const file = await writeResult("reference", result);
  console.log(JSON.stringify(result, null, 2));
  console.log(`Wrote ${file}`);

  if (result.wall_seconds >= WALL_LIMIT_SECONDS) {
    fail(
      `Wall time ${result.wall_seconds.toFixed(0)} s is not under ${WALL_LIMIT_SECONDS} s (SC-006).`,
    );
  }
  if (result.peak_thread_heap_bytes >= THREAD_HEAP_LIMIT_BYTES) {
    fail(
      `Peak thread heap ${(result.peak_thread_heap_bytes / 1024 ** 2).toFixed(0)} MiB is not under 1 GiB (SC-007).`,
    );
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
