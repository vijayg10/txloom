import { generateMerchantPool, initPartitionWorld, simulateDay } from "@txloom/engine";
import { fail, referenceSpec } from "./lib.js";

const MAX_RATIO = 2.5; // SC-008: doubling the population may cost at most 2.5× the time

function generationSeconds(consumers: number): number {
  const spec = referenceSpec({
    consumers,
    merchants: 500,
    days: 30,
    typologies: [
      { type: "refund_abuse", share: 1, params: { refund_rate: 0.5, max_refunds_per_actor: 4 } },
    ],
  });
  const seed = BigInt(spec.seed);
  const world = initPartitionWorld(spec, seed, 0, 1, generateMerchantPool(spec, seed));
  const startedAt = performance.now();
  for (let day = 0; day < spec.clock.days; day++) simulateDay(world, day);
  return (performance.now() - startedAt) / 1000;
}

/** Refund abuse used to scan every prior purchase for each refund (quadratic); the purchase
 * rings make it O(1). Compares 2k and 4k consumers on a refund-abuse-only spec. */
function main() {
  generationSeconds(500); // warm up the JIT
  const small = generationSeconds(2_000);
  const large = generationSeconds(4_000);
  const ratio = large / small;
  console.log(
    `2k consumers: ${small.toFixed(2)} s, 4k consumers: ${large.toFixed(2)} s, ratio ${ratio.toFixed(2)}×`,
  );
  if (ratio > MAX_RATIO)
    fail(`Time ratio ${ratio.toFixed(2)}× is above the ${MAX_RATIO}× limit (SC-008).`);
}

main();
