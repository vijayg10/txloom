import type { SimulationSpec } from "@txloom/spec";
import { deriveNamedRng } from "../rng.js";
import { ImperfectionTransformer, type TransformerState } from "../imperfections/transformer.js";
import {
  checkpointWorld,
  restoreWorld,
  type PartitionWorld,
  type WorldCheckpoint,
} from "../world/partition-world.js";
import { simulateDay } from "../world/simulate-day.js";
import type { NamedMerchant } from "../population/named-population.js";
import type { Delivered, LabelRecord, TruthEvent } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One simulated live day: the truth the world produced, and what each sink receives. */
export interface LiveDay {
  dayIndex: number;
  /** Start of the day, simulated time. */
  startMs: number;
  /** Per partition, in generation order: the truth events and their fraud labels (aligned). */
  partitions: { events: TruthEvent[]; labels: LabelRecord[] }[];
  /** Per sink: the day's deliveries, k-way merged across partitions by `delivered_at`. */
  deliveries: Record<string, Delivered[]>;
}

/** A slice of the current day, one entry per sink. Entry `i` of a sink's array is that sink's
 * delivery number `fromIndex + i` of the day; a sink with fewer deliveries than another (it has
 * no duplicates, say) simply runs out first. */
export interface LiveBatch {
  dayIndex: number;
  fromIndex: number;
  bySink: Record<string, Delivered[]>;
  /** Simulated time of the batch's last delivery (`delivered_at`), or the day's start if empty. */
  simTimeMs: number;
  /** Whether this batch reaches the end of the day, so the next one simulates another day. */
  endOfDay: boolean;
}

/** The world as it stood before a day was simulated. Restoring it and simulating that day again
 * reproduces the day exactly, so it is enough to resume a session from (R7). */
export interface LiveDayCheckpoint {
  dayIndex: number;
  partitions: WorldCheckpoint[];
}

function afterOrEqual(aMs: number, aPartition: number, bMs: number, bPartition: number): boolean {
  return aMs > bMs || (aMs === bMs && aPartition >= bPartition);
}

/** k-way merge of lists that are each already in delivery order, by `delivered_at` and then
 * partition. Out-of-order swaps inside one partition's list are preserved, not repaired. */
export function mergeByDeliveredAt(lists: readonly (readonly Delivered[])[]): Delivered[] {
  const heads = lists.map(() => 0);
  const out: Delivered[] = [];
  for (;;) {
    let best = -1;
    let bestMs = 0;
    for (let p = 0; p < lists.length; p++) {
      const item = lists[p]![heads[p]!];
      if (!item) continue;
      const ms = Date.parse(item.payload.delivered_at);
      if (best === -1 || !afterOrEqual(ms, p, bestMs, best)) {
        best = p;
        bestMs = ms;
      }
    }
    if (best === -1) return out;
    out.push(lists[best]![heads[best]!++]!);
  }
}

export interface LiveWorldOptions {
  /** Deliveries of the first simulated day that a previous session already made — skipped so a
   * resumed session carries on after them instead of repeating them. */
  skipFirstDay?: number;
}

/**
 * The live phase of a run: the same `simulateDay` the history ran, continued from the world
 * checkpoints on days `D, D+1, …` (US6), with one imperfection transformer per sink and
 * partition restored from the checkpoint's transformer state. Days are simulated on demand and
 * each sink's deliveries are merged across partitions by `delivered_at`.
 *
 * Because everything is a pure function of the checkpoint, a day can be re-simulated from the
 * checkpoint taken before it and yields identical deliveries — which is how a stopped or crashed
 * session resumes without repeating or losing any (FR-049).
 */
export class LiveWorld {
  private current: LiveDay | null = null;
  private currentCheckpoint: LiveDayCheckpoint | null = null;
  private cursor = 0;
  private dayLength = 0;
  private skipRemaining: number;

  constructor(
    private readonly spec: SimulationSpec,
    private readonly worlds: PartitionWorld[],
    private readonly transformers: Map<string, ImperfectionTransformer[]>,
    private readonly sinks: readonly string[],
    options: LiveWorldOptions = {},
  ) {
    this.skipRemaining = options.skipFirstDay ?? 0;
  }

  /** The day the next `advanceDay()` simulates. */
  get nextDayIndex(): number {
    return this.worlds[0]?.nextDayIndex ?? 0;
  }

  /** Index of the next delivery of the current day to hand out. */
  get position(): number {
    return this.cursor;
  }

  get day(): LiveDay | null {
    return this.current;
  }

  /** The world as it was before the current day was simulated. */
  dayCheckpoint(): LiveDayCheckpoint | null {
    return this.currentCheckpoint;
  }

  /** Simulates the next day on every partition and makes it the current day. */
  advanceDay(): LiveDay {
    const dayIndex = this.nextDayIndex;
    const clockStartMs = Date.parse(`${this.spec.clock.start}T00:00:00.000Z`);
    const startMs = clockStartMs + dayIndex * DAY_MS;
    const dayEndMs = startMs + DAY_MS - 1;

    // Snapshot before simulating: this is what a resume restores.
    this.currentCheckpoint = {
      dayIndex,
      partitions: this.worlds.map((world, partitionNo) => {
        const checkpoint = checkpointWorld(world);
        const transformerStates: Record<string, TransformerState> = {};
        for (const sink of this.sinks) {
          transformerStates[sink] = this.transformers.get(sink)![partitionNo]!.checkpoint();
        }
        return { ...checkpoint, transformers: transformerStates };
      }),
    };

    const partitions = this.worlds.map((world) => simulateDay(world, dayIndex));
    const deliveries: Record<string, Delivered[]> = {};
    for (const sink of this.sinks) {
      const perPartition = partitions.map((day, partitionNo) => {
        const transformer = this.transformers.get(sink)![partitionNo]!;
        for (let i = 0; i < day.events.length; i++) {
          transformer.push(day.events[i]!, day.labels[i]!);
        }
        return transformer.drainUntil(dayEndMs);
      });
      deliveries[sink] = mergeByDeliveredAt(perPartition);
    }

    this.current = { dayIndex, startMs, partitions, deliveries };
    this.dayLength = Math.max(0, ...this.sinks.map((sink) => deliveries[sink]!.length));
    this.cursor = Math.min(this.skipRemaining, this.dayLength);
    this.skipRemaining = 0;
    return this.current;
  }

  /** Up to `maxEvents` more deliveries per sink, simulating further days as needed. */
  nextBatch(maxEvents: number): LiveBatch {
    while (!this.current || this.cursor >= this.dayLength) this.advanceDay();
    const day = this.current;
    const fromIndex = this.cursor;
    const toIndex = Math.min(this.dayLength, fromIndex + Math.max(1, maxEvents));
    const bySink: Record<string, Delivered[]> = {};
    let simTimeMs = day.startMs;
    for (const sink of this.sinks) {
      const slice = day.deliveries[sink]!.slice(fromIndex, toIndex);
      bySink[sink] = slice;
      const last = slice[slice.length - 1];
      if (last) simTimeMs = Math.max(simTimeMs, Date.parse(last.payload.delivered_at));
    }
    this.cursor = toIndex;
    return {
      dayIndex: day.dayIndex,
      fromIndex,
      bySink,
      simTimeMs,
      endOfDay: toIndex >= this.dayLength,
    };
  }
}

/**
 * Opens the live phase from per-partition world checkpoints (the end of history, or a live day
 * checkpoint). Every sink gets a transformer per partition, restored from the checkpoint's
 * transformer state when it has one and otherwise started fresh from a stream derived from the
 * seed, sink and partition.
 */
export function openLiveWorld(
  spec: SimulationSpec,
  seed: bigint,
  checkpoints: readonly WorldCheckpoint[],
  merchants: readonly NamedMerchant[],
  sinks: readonly string[],
  options: LiveWorldOptions = {},
): LiveWorld {
  const worlds = checkpoints.map((checkpoint) => restoreWorld(spec, seed, checkpoint, merchants));
  const transformers = new Map<string, ImperfectionTransformer[]>();
  for (const sink of sinks) {
    transformers.set(
      sink,
      checkpoints.map((checkpoint, partitionNo) => {
        const state = (checkpoint.transformers as Record<string, TransformerState | undefined>)[
          sink
        ];
        return state
          ? ImperfectionTransformer.restore(sink, spec.imperfections, state)
          : ImperfectionTransformer.create(
              sink,
              spec.imperfections,
              deriveNamedRng(seed, `imperfections:${sink}:p${partitionNo}`),
            );
      }),
    );
  }
  return new LiveWorld(spec, worlds, transformers, sinks, options);
}
