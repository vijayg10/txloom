/**
 * Token-bucket rate limiter for the stream-drive job (D16) — one bucket
 * shared across every partition feeding a run's live phase, so the whole
 * stream converges on one target TPS regardless of partition count.
 *
 * Pacing a live stream is inherently about wall-clock time, but this class
 * still never reads the clock itself — callers pass elapsed time explicitly
 * via `refill(deltaMs)`, the same injected-time discipline `clock.ts` uses —
 * so it stays safe to live under `packages/engine` (constitution Principle
 * II) even though its purpose (real-time delivery pacing) is unrelated to
 * generation determinism.
 */
export class TokenBucket {
  private tokens: number;
  private ratePerMs: number;
  private capacity: number;

  constructor(targetTps: number, capacity?: number) {
    this.capacity = capacity ?? Math.max(1, targetTps);
    this.ratePerMs = targetTps / 1000;
    this.tokens = this.capacity;
  }

  /** Live rate adjustment (FR-030) — takes effect on the next refill. */
  setRate(targetTps: number): void {
    this.ratePerMs = Math.max(0, targetTps) / 1000;
    this.capacity = Math.max(1, targetTps);
  }

  refill(deltaMs: number): void {
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, deltaMs) * this.ratePerMs);
  }

  /** Removes up to `max` whole tokens, returning how many were actually available. */
  consume(max: number): number {
    const taken = Math.min(max, Math.floor(this.tokens));
    this.tokens -= taken;
    return taken;
  }
}
