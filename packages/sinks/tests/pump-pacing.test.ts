import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AimdPacer,
  DeliveryPump,
  PumpBreakerError,
  type PumpItem,
  type Sink,
  type SinkPublishResult,
} from "../src/index.js";

const item = (n: number): PumpItem => ({
  body: new Uint8Array([n]),
  envelope: { delivery_id: `d${n}`, event_id: `e${n}` },
});

/** A sink whose publishes the test settles by hand. */
class ManualSink implements Sink {
  readonly type = "webhook" as const;
  readonly name = "manual";
  saturated = false;
  readonly pending: ((result: SinkPublishResult) => void)[] = [];
  constructor(readonly maxInFlight: number) {}
  publish(): Promise<SinkPublishResult> {
    return new Promise((resolve) => this.pending.push(resolve));
  }
  async probe() {
    return { ok: true, stage: "done" as const, detail: "", latency_ms: 0 };
  }
  async close() {}
}

describe("AimdPacer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts at the target rate", () => {
    expect(new AimdPacer({ targetTps: 100 }).rate()).toBe(100);
  });

  it("halves on backpressure, with a floor of 1", () => {
    const pacer = new AimdPacer({ targetTps: 6 });
    pacer.onBackpressure();
    expect(pacer.rate()).toBe(3);
    vi.advanceTimersByTime(1000);
    pacer.onBackpressure();
    expect(pacer.rate()).toBeLessThanOrEqual(1.5 + 0.3);
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(1000);
      pacer.onBackpressure();
    }
    expect(pacer.rate()).toBeGreaterThanOrEqual(1);
    expect(pacer.rate()).toBeLessThanOrEqual(1.3);
  });

  it("counts a burst of backpressure signals within one second as one halving", () => {
    const pacer = new AimdPacer({ targetTps: 100 });
    for (let i = 0; i < 20; i++) pacer.onBackpressure();
    expect(pacer.rate()).toBe(50);
  });

  it("recovers by 5% of the target per second, up to the target", () => {
    const pacer = new AimdPacer({ targetTps: 100 });
    pacer.onBackpressure(); // 50
    vi.advanceTimersByTime(1000);
    expect(pacer.rate()).toBeCloseTo(55, 5);
    vi.advanceTimersByTime(2000);
    expect(pacer.rate()).toBeCloseTo(65, 5);
    vi.advanceTimersByTime(60_000);
    expect(pacer.rate()).toBe(100);
  });

  it("follows a changed target: never above it, and recovers toward the new one", () => {
    const pacer = new AimdPacer({ targetTps: 100 });
    pacer.setTarget(40);
    expect(pacer.rate()).toBe(40);
    pacer.setTarget(200);
    vi.advanceTimersByTime(1000);
    expect(pacer.rate()).toBeLessThanOrEqual(200);
    expect(pacer.rate()).toBeGreaterThanOrEqual(40);
  });

  it("paces acquire() to the effective rate", async () => {
    const pacer = new AimdPacer({ targetTps: 10 });
    let released = 0;
    const waiters = Array.from({ length: 30 }, () => pacer.acquire().then(() => released++));
    await vi.advanceTimersByTimeAsync(0);
    const burst = released; // the bucket's initial capacity goes out at once
    expect(burst).toBeLessThanOrEqual(10);
    await vi.advanceTimersByTimeAsync(1000);
    // About one more second's worth of tokens (10 per second), not the whole backlog.
    expect(released - burst).toBeGreaterThanOrEqual(8);
    expect(released - burst).toBeLessThanOrEqual(12);
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(waiters);
    expect(released).toBe(30);
  });
});

describe("DeliveryPump metrics and breaker", () => {
  it("sink_lag is in_flight + retry_queue + the backlog waiting for a slot", async () => {
    const sink = new ManualSink(2);
    const pump = new DeliveryPump({
      sink,
      onDropped: () => {},
      maxAttempts: 3,
      backoff: { baseMs: 60_000, maxMs: 60_000 },
    });
    for (let n = 1; n <= 5; n++) void pump.submit(item(n));
    await Promise.resolve();
    await Promise.resolve();
    // Two publishing, three waiting for a window slot.
    let metrics = pump.metrics();
    expect(metrics.in_flight).toBe(2);
    expect(metrics.sink_lag).toBe(5);

    // A retryable failure moves one delivery from in flight into the retry queue, and the freed
    // slot goes to a waiter: 2 in flight + 1 retrying + 2 waiting.
    sink.pending.shift()!({ ok: false, retryable: true, error: "boom" });
    await Promise.resolve();
    await Promise.resolve();
    metrics = pump.metrics();
    expect(metrics.retry_queue).toBe(1);
    expect(metrics.sink_lag).toBe(metrics.in_flight + metrics.retry_queue + 2);
    pump.stop();
  });

  it("trips the breaker when more than half of 100+ completions failed, and not below 100", async () => {
    const tripped: PumpBreakerError[] = [];
    const sink = new ManualSink(1000);
    const pump = new DeliveryPump({
      sink,
      maxAttempts: 1,
      onDropped: () => {},
      onBreaker: (error) => tripped.push(error),
    });
    for (let n = 1; n <= 99; n++) await pump.submit(item(n));
    for (const settle of sink.pending.splice(0))
      settle({ ok: false, retryable: false, error: "down" });
    await new Promise((r) => setTimeout(r, 0));
    expect(tripped).toHaveLength(0); // 99 failures, but under the 100-completion minimum

    await pump.submit(item(100));
    sink.pending.shift()!({ ok: false, retryable: false, error: "down" });
    await new Promise((r) => setTimeout(r, 0));
    expect(tripped).toHaveLength(1);
    expect(tripped[0]!.completed).toBeGreaterThanOrEqual(100);
    await expect(pump.submit(item(101))).rejects.toBeInstanceOf(PumpBreakerError);
  });

  it("does not trip when at most half the completions failed", async () => {
    const tripped: PumpBreakerError[] = [];
    const sink = new ManualSink(1000);
    const pump = new DeliveryPump({
      sink,
      maxAttempts: 1,
      onDropped: () => {},
      onBreaker: (e) => tripped.push(e),
    });
    for (let n = 1; n <= 200; n++) await pump.submit(item(n));
    sink.pending
      .splice(0)
      .forEach((settle, i) =>
        settle(i % 2 === 0 ? { ok: true } : { ok: false, retryable: false, error: "x" }),
      );
    await new Promise((r) => setTimeout(r, 0));
    expect(tripped).toHaveLength(0);
  });
});
