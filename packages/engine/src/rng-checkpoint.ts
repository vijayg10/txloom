import type { RngCheckpoint, Rng } from "./rng.js";
import { restoreRng } from "./rng.js";
import type { ClockCheckpoint, VirtualClock } from "./clock.js";
import { restoreClock } from "./clock.js";

/** The JSON stored in run_partitions.rng_checkpoint (data-model.md) — RNG stream
 * state plus the virtual-clock cursor, everything a worker needs to resume a
 * partition exactly where it left off after a crash (FR-018, SC-011). */
export interface PartitionCheckpoint {
  rng: RngCheckpoint;
  clock: ClockCheckpoint;
  /** Count of truth events already emitted for this partition — resume must not re-emit these. */
  eventsGenerated: number;
}

export function serializePartitionCheckpoint(checkpoint: PartitionCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function parsePartitionCheckpoint(json: string): PartitionCheckpoint {
  const parsed = JSON.parse(json) as PartitionCheckpoint;
  if (!parsed.rng || !parsed.clock || typeof parsed.eventsGenerated !== "number") {
    throw new Error("Malformed partition checkpoint JSON");
  }
  return parsed;
}

export function capturePartitionCheckpoint(
  rng: Rng,
  clock: VirtualClock,
  eventsGenerated: number,
): PartitionCheckpoint {
  return { rng: rng.checkpoint(), clock: clock.checkpoint(), eventsGenerated };
}

export function resumeFromCheckpoint(
  clockStartISO: string,
  checkpoint: PartitionCheckpoint,
): { rng: Rng; clock: VirtualClock; eventsGenerated: number } {
  return {
    rng: restoreRng(checkpoint.rng),
    clock: restoreClock(clockStartISO, checkpoint.clock),
    eventsGenerated: checkpoint.eventsGenerated,
  };
}
