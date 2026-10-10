import { generateMerchantPool, type NamedMerchant } from "@txloom/engine";
import type { SimulationSpec } from "@txloom/spec";

const MAX_ENTRIES = 8;
const cache = new Map<string, NamedMerchant[]>();

/** The run's merchant pool, built on first use and kept in a small LRU (R3). It is a pure
 * function of `(spec, seed, engine version)`, so every thread rebuilds the same pool and no
 * job payload has to carry it. */
export function getMerchants(
  runId: string,
  engineVersion: number,
  spec: SimulationSpec,
  seed: bigint,
): NamedMerchant[] {
  const key = `${runId}:${engineVersion}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const merchants = generateMerchantPool(spec, seed);
  cache.set(key, merchants);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return merchants;
}
