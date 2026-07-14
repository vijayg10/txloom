import { factory } from "ulid";
import type { Rng } from "./rng.js";

/** A ULID generator bound to the seeded RNG and a caller-supplied virtual-clock
 * timestamp — `ulid` defaults to Date.now() + Math.random(), both banned inside
 * the engine (constitution Principle II), so every call site must go through
 * this factory instead of the package's own `ulid()` export. */
export function createDeterministicUlid(rng: Rng): (seedTimeMs: number) => string {
  return factory(() => rng.nextFloat());
}
