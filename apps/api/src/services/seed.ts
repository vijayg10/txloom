export const MAX_SEED = (1n << 64n) - 1n;

export class InvalidSeedError extends Error {
  readonly code = "invalid_seed";
  readonly path = "/seed";
  constructor(detail: string) {
    super(
      `${detail} A seed must be a decimal string (or a safe integer) from 0 to ${MAX_SEED}; pass seeds above 9007199254740991 as strings.`,
    );
  }
}

/** Parses a launch `seed`: a decimal string, or a JSON number that is a safe integer, in
 * `[0, 2^64-1]` (research R2). JSON numbers above 2^53 are rejected rather than rounded —
 * the client has already lost the low bits by then. */
export function parseSeed(input: unknown): bigint {
  let seed: bigint;
  if (typeof input === "string") {
    if (!/^\d+$/.test(input))
      throw new InvalidSeedError(`"${input}" is not a non-negative integer.`);
    seed = BigInt(input);
  } else if (typeof input === "number") {
    if (!Number.isSafeInteger(input)) {
      throw new InvalidSeedError(`${input} is not a safe integer, so it may have lost precision.`);
    }
    seed = BigInt(input);
  } else {
    throw new InvalidSeedError("The seed is missing or not a string or integer.");
  }
  if (seed < 0n || seed > MAX_SEED) throw new InvalidSeedError(`${seed} is out of range.`);
  return seed;
}
