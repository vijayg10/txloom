import { describe, expect, it } from "vitest";
import {
  DeliveryPump,
  PumpBreakerError,
  type DroppedLabel,
  type PumpItem,
  type Sink,
  type SinkPublishResult,
} from "../src/index.js";

interface FakeOptions {
  maxInFlight?: number;
  latencyMs?: number;
  /** Decides each attempt's outcome: `attempt` counts per event_id, starting at 1. */
  outcome?: (eventId: string, attempt: number) => SinkPublishResult;
}

class FakeSink implements Sink {
  readonly type = "webhook" as const;
  readonly name = "fake";
  readonly maxInFlight: number;
  inFlight = 0;
  peak = 0;
  attempts = new Map<string, number>();
  attemptTimes = new Map<string, number[]>();

  constructor(private readonly options: FakeOptions = {}) {
    this.maxInFlight = options.maxInFlight ?? 4;
  }

  async publish(
    _target: unknown,
    _body: Uint8Array,
    envelope: { event_id: string },
  ): Promise<SinkPublishResult> {
    const attempt = (this.attempts.get(envelope.event_id) ?? 0) + 1;
    this.attempts.set(envelope.event_id, attempt);
    this.attemptTimes.set(envelope.event_id, [
      ...(this.attemptTimes.get(envelope.event_id) ?? []),
      Date.now(),
    ]);
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs ?? 5));
    this.inFlight--;
    return this.options.outcome?.(envelope.event_id, attempt) ?? { ok: true };
  }

  async probe() {
    return { ok: true, stage: "done" as const, detail: "", latency_ms: 0 };
  }

  async close() {}
}

const item = (id: string): PumpItem => ({
  body: new Uint8Array([1]),
  envelope: { delivery_id: `d-${id}`, event_id: id },
});

function pumpFor(sink: Sink, extra: { maxAttempts?: number } = {}) {
  const dropped: DroppedLabel[] = [];
  const pump = new DeliveryPump({
    sink,
    maxAttempts: extra.maxAttempts ?? 3,
    backoff: { baseMs: 2, maxMs: 20 },
    onDropped: (label) => {
      dropped.push(label);
    },
  });
  return { pump, dropped };
}

describe("DeliveryPump", () => {
  it("never keeps more than maxInFlight publishes outstanding", async () => {
    const sink = new FakeSink({ maxInFlight: 3, latencyMs: 10 });
    const { pump } = pumpFor(sink);
    for (let i = 0; i < 30; i++) await pump.submit(item(`e${i}`));
    await pump.drain();
    expect(sink.peak).toBeLessThanOrEqual(3);
    expect(sink.peak).toBeGreaterThan(1);
  });

  it("counts a delivery only when publish resolves ok", async () => {
    const sink = new FakeSink({
      outcome: (id) =>
        id === "bad" ? { ok: false, retryable: false, error: "nope" } : { ok: true },
    });
    const { pump, dropped } = pumpFor(sink);
    for (const id of ["a", "b", "bad", "c"]) await pump.submit(item(id));
    await pump.drain();
    const metrics = pump.metrics();
    expect(metrics.delivered_total).toBe(3);
    expect(metrics.failed_total).toBe(1);
    expect(dropped.map((d) => d.event_id)).toEqual(["bad"]);
  });

  it("re-attempts retryable failures with backoff until they succeed", async () => {
    const sink = new FakeSink({
      outcome: (_id, attempt) =>
        attempt < 3 ? { ok: false, retryable: true, error: "503" } : { ok: true },
    });
    const { pump, dropped } = pumpFor(sink, { maxAttempts: 5 });
    await pump.submit(item("flaky"));
    await pump.drain();
    expect(sink.attempts.get("flaky")).toBe(3);
    expect(pump.metrics().delivered_total).toBe(1);
    expect(dropped).toEqual([]);
    const times = sink.attemptTimes.get("flaky")!;
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1);
  });

  it("emits exactly one dropped label once max_attempts is exhausted", async () => {
    const sink = new FakeSink({
      outcome: () => ({ ok: false, retryable: true, error: "HTTP 500" }),
    });
    const { pump, dropped } = pumpFor(sink, { maxAttempts: 3 });
    await pump.submit(item("doomed"));
    await pump.drain();
    expect(sink.attempts.get("doomed")).toBe(3);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({
      event_id: "doomed",
      sink: "fake",
      delivery_outcome: "dropped",
      corruption_type: null,
      corruption_detail: { error: "HTTP 500", attempts: 3 },
    });
    expect(pump.metrics().failed_total).toBe(1);
  });

  it("drops a non-retryable error immediately, after one attempt", async () => {
    const sink = new FakeSink({
      outcome: () => ({ ok: false, retryable: false, error: "HTTP 400" }),
    });
    const { pump, dropped } = pumpFor(sink, { maxAttempts: 5 });
    await pump.submit(item("rejected"));
    await pump.drain();
    expect(sink.attempts.get("rejected")).toBe(1);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.corruption_detail).toEqual({ error: "HTTP 400", attempts: 1 });
  });

  it("interleaves due retries with new deliveries inside the window", async () => {
    const sink = new FakeSink({
      maxInFlight: 2,
      outcome: (id, attempt) =>
        id === "retry-me" && attempt === 1 ? { ok: false, retryable: true } : { ok: true },
    });
    const { pump } = pumpFor(sink);
    await pump.submit(item("retry-me"));
    for (let i = 0; i < 20; i++) await pump.submit(item(`n${i}`));
    await pump.drain();
    expect(sink.peak).toBeLessThanOrEqual(2);
    expect(pump.metrics().delivered_total).toBe(21);
  });

  it("trips the breaker when most completions in the window failed", async () => {
    const sink = new FakeSink({
      maxInFlight: 8,
      latencyMs: 1,
      outcome: () => ({ ok: false, retryable: false, error: "down" }),
    });
    let tripped: PumpBreakerError | null = null;
    const pump = new DeliveryPump({
      sink,
      backoff: { baseMs: 1, maxMs: 2 },
      onDropped: () => {},
      onBreaker: (error) => {
        tripped = error;
      },
    });
    await expect(
      (async () => {
        for (let i = 0; i < 500; i++) await pump.submit(item(`x${i}`));
        await pump.drain();
      })(),
    ).rejects.toBeInstanceOf(PumpBreakerError);
    expect(tripped).not.toBeNull();
  });

  it("reports a metrics snapshot", async () => {
    const sink = new FakeSink({ maxInFlight: 1, latencyMs: 5 });
    const { pump } = pumpFor(sink);
    for (let i = 0; i < 5; i++) await pump.submit(item(`m${i}`));
    await pump.drain();
    const metrics = pump.metrics();
    expect(metrics).toMatchObject({
      delivered_total: 5,
      failed_total: 0,
      in_flight: 0,
      retry_queue: 0,
    });
    expect(metrics.backpressure).toBe(true);
    expect(metrics.sink_lag).toBeGreaterThan(0);
    expect(pump.metrics().backpressure).toBe(false);
  });
});
