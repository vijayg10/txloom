import type { Sink, SinkTarget } from "./interface.js";

/** One delivery handed to the pump. `body` is already wire-encoded (`encodeWirePayload`). */
export interface PumpItem {
  body: Uint8Array;
  envelope: { delivery_id: string; event_id: string };
  target?: SinkTarget;
}

/** The answer-key row written for a delivery the pump gave up on (FR-023). It has the shape of
 * the engine's `LabelRecord`; `corruption_type` stays null because it is reserved for the four
 * injectable imperfections. */
export interface DroppedLabel {
  event_id: string;
  is_fraud: false;
  typology: null;
  actor_id: null;
  campaign_step: null;
  corruption_type: null;
  corruption_detail: { error: string; attempts: number };
  sink: string;
  delivery_outcome: "dropped";
}

export interface PumpMetrics {
  achieved_tps: number;
  aimd_rate: number | null;
  in_flight: number;
  retry_queue: number;
  /** Messages the destination owes us: in flight + waiting to retry + waiting for a slot. */
  sink_lag: number;
  backpressure: boolean;
  delivered_total: number;
  failed_total: number;
}

/** Live pacing (US7). Replay runs without one. */
export interface PacingHook {
  /** Resolves when the next publish may start. */
  acquire(): Promise<void>;
  /** The pump hit its window, the transport reported saturation, or a publish was throttled. */
  onBackpressure?(): void;
  onCompletion?(ok: boolean): void;
  /** Current paced rate, reported as `aimd_rate`. */
  rate?(): number;
}

/**
 * Live pacing with additive-increase / multiplicative-decrease (US7): the effective rate is
 * `min(target, aimd)`. Backpressure (a full window, a saturated transport, a throttled publish)
 * halves `aimd` — at most once a second, so one burst of signals counts once — down to a floor of
 * 1/s, and every quiet second adds 5% of the target back. `acquire()` releases publishes at the
 * effective rate from a token bucket holding one second of burst.
 */
export class AimdPacer implements PacingHook {
  private target: number;
  private aimd: number;
  private lastTick: number;
  private lastHalvedAt = Number.NEGATIVE_INFINITY;
  private tokens: number;
  private lastRefill: number;
  private chain: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(options: { targetTps: number; now?: () => number }) {
    this.now = options.now ?? Date.now;
    this.target = Math.max(1, options.targetTps);
    this.aimd = this.target;
    this.lastTick = this.lastRefill = this.now();
    this.tokens = this.target;
  }

  /** The stream's rate was changed. */
  setTarget(targetTps: number): void {
    this.recover();
    // A pacer that was not throttled follows the new target in both directions; a throttled one
    // never exceeds it and climbs back at the usual 5% a second.
    const unthrottled = this.aimd >= this.target;
    this.target = Math.max(1, targetTps);
    this.aimd = unthrottled ? this.target : Math.min(this.aimd, this.target);
  }

  private recover(): void {
    const at = this.now();
    const elapsedSeconds = Math.max(0, at - this.lastTick) / 1000;
    this.lastTick = at;
    this.aimd = Math.min(this.target, this.aimd + 0.05 * this.target * elapsedSeconds);
  }

  rate(): number {
    this.recover();
    return Math.min(this.target, this.aimd);
  }

  onBackpressure(): void {
    this.recover();
    const at = this.now();
    if (at - this.lastHalvedAt < 1000) return;
    this.lastHalvedAt = at;
    this.aimd = Math.max(1, this.aimd / 2);
  }

  acquire(): Promise<void> {
    const next = this.chain.then(() => this.take());
    this.chain = next.catch(() => {});
    return next;
  }

  private async take(): Promise<void> {
    for (;;) {
      const rate = this.rate();
      const at = this.now();
      this.tokens = Math.min(
        Math.max(1, rate),
        this.tokens + ((at - this.lastRefill) / 1000) * rate,
      );
      this.lastRefill = at;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.ceil(((1 - this.tokens) / rate) * 1000)),
      );
    }
  }
}

export interface PumpOptions {
  sink: Sink;
  target?: SinkTarget;
  /** Attempts per delivery before it is dropped (the connection's setting for webhooks, 5 otherwise). */
  maxAttempts?: number;
  onDropped: (label: DroppedLabel, item: PumpItem) => void | Promise<void>;
  onDelivered?: (item: PumpItem) => void;
  pacing?: PacingHook;
  /** Called once if the breaker trips. */
  onBreaker?: (error: PumpBreakerError) => void;
  backoff?: { baseMs: number; maxMs: number };
  random?: () => number;
  now?: () => number;
}

export class PumpBreakerError extends Error {
  constructor(
    readonly failed: number,
    readonly completed: number,
  ) {
    super(
      `More than half of the last ${completed} deliveries failed (${failed}); the destination looks down.`,
    );
    this.name = "PumpBreakerError";
  }
}

const BREAKER_WINDOW_MS = 30_000;
const BREAKER_MIN_COMPLETIONS = 100;

interface Attempt {
  item: PumpItem;
  attempts: number;
  due: number;
  seq: number;
}

/** Binary min-heap on `(due, seq)`. */
class RetryHeap {
  private items: Attempt[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): Attempt | undefined {
    return this.items[0];
  }

  private before(a: Attempt, b: Attempt): boolean {
    return a.due !== b.due ? a.due < b.due : a.seq < b.seq;
  }

  push(item: Attempt): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  pop(): Attempt | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && this.before(items[left]!, items[smallest]!)) smallest = left;
        if (right < items.length && this.before(items[right]!, items[smallest]!)) smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest]!, items[i]!];
        i = smallest;
      }
    }
    return top;
  }

  clear(): void {
    this.items = [];
  }
}

/**
 * The shared delivery loop for history replay and live streams (contracts/sink-plugin.md).
 *
 * - Keeps at most `sink.maxInFlight` publishes outstanding; a full window, a saturated transport
 *   or a throttled publish counts as backpressure.
 * - Counts a delivery only when `publish` resolves `ok` — the destination's acknowledgement.
 * - Retries retryable failures from a min-heap with jittered exponential backoff, interleaved
 *   with new deliveries, up to `maxAttempts`.
 * - After the last attempt, or on a non-retryable error, emits exactly one `dropped` label.
 * - Trips a breaker when more than half of the last 30 s of completions failed (minimum 100).
 */
export class DeliveryPump {
  private readonly sink: Sink;
  private readonly maxAttempts: number;
  private readonly backoff: { baseMs: number; maxMs: number };
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly abort = new AbortController();

  private inFlight = 0;
  private readonly retries = new RetryHeap();
  private readonly ready: Attempt[] = [];
  private readonly slotWaiters: (() => void)[] = [];
  private idleWaiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private stopped = false;
  private tripped: PumpBreakerError | null = null;
  private pending = 0;

  private delivered = 0;
  private failed = 0;
  private backpressure = false;
  private lastSample = { at: 0, delivered: 0 };
  private completions: { at: number; ok: boolean }[] = [];
  private completionsHead = 0;
  private failuresInWindow = 0;

  constructor(private readonly options: PumpOptions) {
    this.sink = options.sink;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? options.sink.maxAttempts ?? 5);
    this.backoff = options.backoff ?? { baseMs: 200, maxMs: 30_000 };
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.lastSample.at = this.now();
  }

  /** Queues one delivery. Resolves once it has a window slot and has started publishing, so a
   * caller that awaits it is paced by the destination. Returns false if the pump has stopped. */
  async submit(item: PumpItem): Promise<boolean> {
    if (this.tripped) throw this.tripped;
    if (this.stopped) return false;
    this.pending++;
    try {
      if (this.options.pacing) await this.options.pacing.acquire();
      if (this.sink.saturated) {
        this.noteBackpressure();
        await this.sink.waitForCapacity?.();
      }
      if (!(await this.reserveSlot())) {
        this.pending--;
        return false;
      }
    } catch (error) {
      this.pending--;
      throw error;
    }
    this.launch({ item, attempts: 0, due: 0, seq: this.seq++ });
    return true;
  }

  private reserveSlot(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (this.inFlight < this.window && this.ready.length === 0) {
      this.inFlight++;
      return Promise.resolve(true);
    }
    this.noteBackpressure();
    return new Promise<boolean>((resolve) => {
      this.slotWaiters.push(() => resolve(!this.stopped));
    });
  }

  /** The sink's window; a plugin that forgot `maxInFlight` is treated as serial. */
  private get window(): number {
    const declared = this.sink.maxInFlight;
    return Number.isFinite(declared) && declared >= 1 ? Math.floor(declared) : 1;
  }

  private noteBackpressure(): void {
    this.backpressure = true;
    this.options.pacing?.onBackpressure?.();
  }

  private launch(attempt: Attempt): void {
    this.sink
      .publish(
        attempt.item.target ?? this.options.target ?? {},
        attempt.item.body,
        attempt.item.envelope,
        this.abort.signal,
      )
      .catch((error: unknown) => ({
        ok: false as const,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      }))
      .then((result) => this.complete(attempt, result));
  }

  private complete(
    attempt: Attempt,
    result: { ok: boolean; retryable?: boolean; error?: string },
  ): void {
    this.inFlight--;
    const at = this.now();
    attempt.attempts++;

    if (result.ok) {
      this.delivered++;
      this.recordCompletion(true);
      this.options.pacing?.onCompletion?.(true);
      this.options.onDelivered?.(attempt.item);
      this.finish();
    } else if (!this.stopped && result.retryable !== false && attempt.attempts < this.maxAttempts) {
      this.recordCompletion(false);
      this.options.pacing?.onCompletion?.(false);
      attempt.due = at + this.backoffMs(attempt.attempts);
      attempt.seq = this.seq++;
      this.retries.push(attempt);
      this.armTimer();
    } else if (this.stopped) {
      // Aborted by stop(): the delivery is abandoned, not failed.
      this.pending--;
    } else {
      this.failed++;
      this.recordCompletion(false);
      this.options.pacing?.onCompletion?.(false);
      const label: DroppedLabel = {
        event_id: attempt.item.envelope.event_id,
        is_fraud: false,
        typology: null,
        actor_id: null,
        campaign_step: null,
        corruption_type: null,
        corruption_detail: { error: result.error ?? "delivery failed", attempts: attempt.attempts },
        sink: this.sink.name,
        delivery_outcome: "dropped",
      };
      void Promise.resolve(this.options.onDropped(label, attempt.item)).finally(() =>
        this.finish(),
      );
    }
    this.dispatch();
    this.checkBreaker();
    this.checkIdle();
  }

  private finish(): void {
    this.pending--;
    this.checkIdle();
  }

  private backoffMs(attempts: number): number {
    const exponential = Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** (attempts - 1));
    return exponential * (0.5 + this.random());
  }

  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    const next = this.retries.peek();
    if (!next || this.stopped) {
      this.timer = null;
      return;
    }
    this.timer = setTimeout(
      () => {
        this.timer = null;
        const now = this.now();
        for (let due = this.retries.peek(); due && due.due <= now; due = this.retries.peek()) {
          this.ready.push(this.retries.pop()!);
        }
        this.dispatch();
        this.armTimer();
      },
      Math.max(0, next.due - this.now()),
    );
  }

  /** Hands free window slots to due retries first, then to waiting submitters. */
  private dispatch(): void {
    while (this.inFlight < this.window) {
      const retry = this.ready.shift();
      if (retry) {
        this.inFlight++;
        this.launch(retry);
        continue;
      }
      const waiter = this.slotWaiters.shift();
      if (!waiter) break;
      this.inFlight++;
      waiter();
    }
  }

  private recordCompletion(ok: boolean): void {
    const at = this.now();
    this.completions.push({ at, ok });
    if (!ok) this.failuresInWindow++;
    while (
      this.completionsHead < this.completions.length &&
      this.completions[this.completionsHead]!.at < at - BREAKER_WINDOW_MS
    ) {
      if (!this.completions[this.completionsHead]!.ok) this.failuresInWindow--;
      this.completionsHead++;
    }
    if (this.completionsHead > 4096) {
      this.completions = this.completions.slice(this.completionsHead);
      this.completionsHead = 0;
    }
  }

  private checkBreaker(): void {
    if (this.tripped || this.stopped) return;
    const completed = this.completions.length - this.completionsHead;
    if (completed >= BREAKER_MIN_COMPLETIONS && this.failuresInWindow * 2 > completed) {
      this.tripped = new PumpBreakerError(this.failuresInWindow, completed);
      this.stop();
      this.options.onBreaker?.(this.tripped);
      for (const waiter of this.idleWaiters) waiter.reject(this.tripped);
      this.idleWaiters = [];
    }
  }

  private checkIdle(): void {
    if (this.pending > 0 || this.idleWaiters.length === 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter.resolve();
  }

  /** Resolves when every submitted delivery has been delivered or dropped. Rejects if the
   * breaker tripped. */
  drain(): Promise<void> {
    if (this.tripped) return Promise.reject(this.tripped);
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve, reject) => this.idleWaiters.push({ resolve, reject }));
  }

  /** Aborts in-flight publishes and abandons pending retries (they are not labelled dropped:
   * the stream ended, the destination did not fail). */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending -= this.retries.size + this.ready.length;
    this.retries.clear();
    this.ready.length = 0;
    for (const waiter of this.slotWaiters.splice(0)) waiter();
    this.checkIdle();
  }

  get breaker(): PumpBreakerError | null {
    return this.tripped;
  }

  /** A snapshot, intended to be read about once a second. Clears the backpressure flag. */
  metrics(): PumpMetrics {
    const at = this.now();
    const elapsedSeconds = Math.max((at - this.lastSample.at) / 1000, 0.001);
    const achieved = (this.delivered - this.lastSample.delivered) / elapsedSeconds;
    this.lastSample = { at, delivered: this.delivered };
    const snapshot: PumpMetrics = {
      achieved_tps: achieved,
      aimd_rate: this.options.pacing?.rate?.() ?? null,
      in_flight: this.inFlight,
      retry_queue: this.retries.size + this.ready.length,
      sink_lag: this.inFlight + this.retries.size + this.ready.length + this.slotWaiters.length,
      backpressure: this.backpressure,
      delivered_total: this.delivered,
      failed_total: this.failed,
    };
    this.backpressure = false;
    return snapshot;
  }
}
