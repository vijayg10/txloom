import { randomNormal, randomLogNormal, randomExponential, randomInt } from "d3-random";
import type { Rng } from "./rng.js";

// d3-random distributions bound to the seeded RNG via .source() (D7) — every
// statistical draw in the engine flows through here, never Math.random.

function source(rng: Rng) {
  return () => rng.nextFloat();
}

export function normal(rng: Rng, mean: number, stddev: number): number {
  return randomNormal.source(source(rng))(mean, stddev)();
}

/** `mean`/`stddev` here parameterize the underlying normal in log-space, per d3-random. */
export function logNormal(rng: Rng, mean: number, stddev: number): number {
  return randomLogNormal.source(source(rng))(mean, stddev)();
}

export function exponential(rng: Rng, lambda: number): number {
  return randomExponential.source(source(rng))(lambda)();
}

/** Uniform integer in [min, maxExclusive). */
export function randInt(rng: Rng, min: number, maxExclusive: number): number {
  return randomInt.source(source(rng))(min, maxExclusive)();
}

/** Clamped non-negative draw from a named distribution kind — used for
 * amount_distribution and similar spec-declared shapes. */
export function drawAmount(
  rng: Rng,
  kind: "lognormal" | "normal" | "exponential",
  mean: number,
  stddev = 0,
): number {
  const raw =
    kind === "lognormal"
      ? logNormal(
          rng,
          Math.log(Math.max(mean, 1e-6)),
          stddev > 0 ? stddev / Math.max(mean, 1e-6) : 0.5,
        )
      : kind === "normal"
        ? normal(rng, mean, stddev)
        : exponential(rng, 1 / Math.max(mean, 1e-6));
  return Math.max(0.01, Math.round(raw * 100) / 100);
}
