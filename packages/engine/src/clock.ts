// Constitution Principle II / D7: the engine never reads the wall clock. Every
// timestamp flows from a VirtualClock instance seeded from spec.clock.start.

export interface ClockCheckpoint {
  readonly cursorMs: number;
}

export class VirtualClock {
  private cursorMs: number;
  private readonly startMs: number;

  constructor(startISO: string, cursorMs?: number) {
    this.startMs = Date.parse(`${startISO}T00:00:00.000Z`);
    if (Number.isNaN(this.startMs)) {
      throw new Error(`VirtualClock: invalid ISO date "${startISO}"`);
    }
    this.cursorMs = cursorMs ?? this.startMs;
  }

  /** Current virtual time as epoch milliseconds. */
  nowMs(): number {
    return this.cursorMs;
  }

  now(): Date {
    return new Date(this.cursorMs);
  }

  /** Advances the cursor and returns the new virtual time. Never reads Date.now(). */
  advance(deltaMs: number): Date {
    this.cursorMs += deltaMs;
    return this.now();
  }

  /** Milliseconds elapsed since clock.start — the persona-space day/hour math anchor. */
  elapsedMs(): number {
    return this.cursorMs - this.startMs;
  }

  checkpoint(): ClockCheckpoint {
    return { cursorMs: this.cursorMs };
  }
}

export function restoreClock(startISO: string, checkpoint: ClockCheckpoint): VirtualClock {
  return new VirtualClock(startISO, checkpoint.cursorMs);
}
