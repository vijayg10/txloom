import { Worker } from "node:worker_threads";
import path from "node:path";
import {
  openLiveWorld,
  type LiveBatch,
  type LiveDayCheckpoint,
  type LiveWorld,
  type NamedMerchant,
  type WorldCheckpoint,
} from "@txloom/engine";
import type { SimulationSpec } from "@txloom/spec";

/** A slice of one simulated day for every sink. The first chunk of a day also carries the
 * checkpoint taken before that day was simulated (what a resume restores). */
export interface LiveChunk extends LiveBatch {
  /** Deliveries per sink in this chunk: the length of the longest sink list. */
  length: number;
  dayCheckpoint?: LiveDayCheckpoint;
  /** Set when the live thread already wrote this day's checkpoint file itself, so the (large)
   * world never crosses to the delivery thread. */
  checkpointWrittenDay?: number;
}

/** Where the stream's deliveries come from. Production uses a dedicated thread; tests can run the
 * same world in-process. */
export interface LiveSource {
  /** The next chunk of at most `maxEvents` deliveries per sink, never crossing a day boundary. */
  take(maxEvents: number): Promise<LiveChunk>;
  /** Deliveries buffered ahead of `take`. */
  readonly buffered: number;
  close(): Promise<void>;
}

export interface LiveSourceInit {
  spec: SimulationSpec;
  /** Decimal string, as in the job payload. */
  seed: string;
  runId: string;
  engineVersion: number;
  checkpoints: WorldCheckpoint[];
  sinks: string[];
  /** Deliveries of the first simulated day that a previous session already made. */
  skipFirstDay: number;
  /** Where the live thread writes day checkpoints; omitted, they are returned in the chunk. */
  checkpointTarget?: { dataDir: string; sessionId: string };
}

/** Latest `delivered_at` among the last delivery of each sink's list, or undefined if all empty. */
function lastDeliveredAt(bySink: LiveChunk["bySink"]): number | undefined {
  let latest: number | undefined;
  for (const list of Object.values(bySink)) {
    const last = list[list.length - 1];
    if (!last) continue;
    const ms = Date.parse(last.payload.delivered_at);
    if (latest === undefined || ms > latest) latest = ms;
  }
  return latest;
}

function chunkLength(batch: LiveBatch): number {
  return Math.max(0, ...Object.values(batch.bySink).map((list) => list.length));
}

/** Runs the live world on the calling thread. Used by tests that inspect the simulator
 * directly; the worker uses `ThreadedLiveSource` so a heavy day never stalls delivery. */
export class InlineLiveSource implements LiveSource {
  private announcedDay = -1;
  readonly buffered = 0;

  constructor(private readonly world: LiveWorld) {}

  static open(init: LiveSourceInit, merchants: readonly NamedMerchant[]): InlineLiveSource {
    return new InlineLiveSource(
      openLiveWorld(init.spec, BigInt(init.seed), init.checkpoints, merchants, init.sinks, {
        skipFirstDay: init.skipFirstDay,
      }),
    );
  }

  async take(maxEvents: number): Promise<LiveChunk> {
    const batch = this.world.nextBatch(maxEvents);
    const chunk: LiveChunk = { ...batch, length: chunkLength(batch) };
    if (batch.dayIndex !== this.announcedDay) {
      this.announcedDay = batch.dayIndex;
      const checkpoint = this.world.dayCheckpoint();
      if (checkpoint) chunk.dayCheckpoint = checkpoint;
    }
    return chunk;
  }

  async close(): Promise<void> {}
}

export interface ThreadedLiveSourceOptions {
  /** Upper bound on deliveries buffered ahead of the consumer (research R5). */
  maxBufferedEvents?: number;
  /** Deliveries fetched from the thread per request. */
  chunkEvents?: number;
}

export const DEFAULT_MAX_BUFFERED_EVENTS = 50_000;
const DEFAULT_CHUNK_EVENTS = 2_000;

type ThreadMessage =
  | { type: "ready" }
  | { type: "chunk"; id: number; chunk: LiveChunk }
  | { type: "error"; id?: number; message: string };

/**
 * The live world in a dedicated worker thread (constitution Principle V). The thread simulates a
 * day at a time, which can take seconds for a large population; this wrapper keeps a buffer of
 * ready chunks so the pumps never wait on it, refilling from a low-water mark and never holding
 * more than `maxBufferedEvents` (research R5).
 */
export class ThreadedLiveSource implements LiveSource {
  private readonly worker: Worker;
  private readonly queue: LiveChunk[] = [];
  private bufferedEvents = 0;
  private requestId = 0;
  private inFlight = false;
  private closed = false;
  private failure: Error | null = null;
  private waiters: (() => void)[] = [];
  private readonly ready: Promise<void>;
  private readonly maxBuffered: number;
  private readonly chunkEvents: number;

  constructor(init: LiveSourceInit, options: ThreadedLiveSourceOptions = {}) {
    this.maxBuffered = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
    this.chunkEvents = Math.max(
      1,
      Math.min(options.chunkEvents ?? DEFAULT_CHUNK_EVENTS, this.maxBuffered),
    );
    this.worker = new Worker(path.join(import.meta.dirname, "live-world-entry.mjs"), {
      workerData: init,
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const onMessage = (message: ThreadMessage) => {
        if (message.type === "ready") {
          resolve();
          return;
        }
        if (message.type === "error") {
          this.fail(new Error(message.message));
          reject(this.failure);
          return;
        }
        this.inFlight = false;
        const { chunk } = message;
        if (chunk.length > 0) {
          this.queue.push(chunk);
          this.bufferedEvents += chunk.length;
        }
        this.wake();
        this.refill();
      };
      this.worker.on("message", onMessage);
      this.worker.on("error", (error) => {
        this.fail(error);
        reject(error);
      });
      this.worker.on("exit", (code) => {
        if (!this.closed && code !== 0) this.fail(new Error(`live world thread exited (${code})`));
      });
    });
    void this.ready.then(() => this.refill()).catch(() => {});
  }

  get buffered(): number {
    return this.bufferedEvents;
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.wake();
  }

  private wake(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const resume of waiting) resume();
  }

  /** Asks the thread for another chunk while there is room for it. */
  private refill(): void {
    if (this.closed || this.failure || this.inFlight) return;
    if (this.bufferedEvents + this.chunkEvents > this.maxBuffered) return;
    this.inFlight = true;
    this.worker.postMessage({ type: "more", id: ++this.requestId, maxEvents: this.chunkEvents });
  }

  async take(maxEvents: number): Promise<LiveChunk> {
    await this.ready;
    for (;;) {
      if (this.failure) throw this.failure;
      const head = this.queue[0];
      if (head) {
        const count = Math.min(Math.max(1, maxEvents), head.length);
        if (count >= head.length) {
          this.queue.shift();
          this.bufferedEvents -= head.length;
          this.refill();
          return head;
        }
        // Split the head chunk: hand out the first `count`, keep the rest in place.
        const bySink: LiveChunk["bySink"] = {};
        const rest: LiveChunk["bySink"] = {};
        for (const [sink, list] of Object.entries(head.bySink)) {
          bySink[sink] = list.slice(0, count);
          rest[sink] = list.slice(count);
        }
        const taken: LiveChunk = {
          dayIndex: head.dayIndex,
          fromIndex: head.fromIndex,
          bySink,
          simTimeMs: lastDeliveredAt(bySink) ?? head.simTimeMs,
          endOfDay: false,
          length: count,
          ...(head.dayCheckpoint ? { dayCheckpoint: head.dayCheckpoint } : {}),
          ...(head.checkpointWrittenDay !== undefined
            ? { checkpointWrittenDay: head.checkpointWrittenDay }
            : {}),
        };
        head.bySink = rest;
        head.fromIndex += count;
        head.length -= count;
        delete head.dayCheckpoint;
        delete head.checkpointWrittenDay;
        this.bufferedEvents -= count;
        this.refill();
        return taken;
      }
      if (this.closed) throw new Error("live source is closed");
      this.refill();
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.wake();
    await this.worker.terminate();
  }
}
