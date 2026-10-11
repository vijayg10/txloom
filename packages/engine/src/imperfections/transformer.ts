import type { ImperfectionsConfig } from "@txloom/spec";
import { createRng, restoreRng, type Rng } from "../rng.js";
import { createDeterministicUlid } from "../id.js";
import { MinHeap } from "../world/min-heap.js";
import { extraDuplicateCount } from "./duplicate.js";
import { lateArrivalDelayMs } from "./late-arrival.js";
import { shouldReorder } from "./out-of-order.js";
import { clockSkewOffsetMs } from "./clock-skew.js";
import type { Delivered, LabelRecord, TruthEvent, WirePayload } from "../types.js";

/** One event's pending deliveries: the primary first, then its duplicates, which always travel
 * together so a duplicate is emitted immediately after its primary (R9). */
export interface DeliveredDraft {
  /** Simulated delivery time: truth `ts` plus any late-arrival delay. */
  deliverAtMs: number;
  seq: number;
  items: Delivered[];
  /** Whether the primary should be overtaken by its successor. */
  reorder: boolean;
}

/** Serializable transformer state, stored in the world checkpoint (data-model.md § TransformerState). */
export interface TransformerState {
  rngState: number[];
  seq: number;
  delayHeap: DeliveredDraft[];
  holdSlot: DeliveredDraft | null;
}

function appliesToSink(sinks: string[] | undefined, sinkName: string): boolean {
  return !sinks || sinks.length === 0 || sinks.includes(sinkName);
}

function draftBefore(a: DeliveredDraft, b: DeliveredDraft): boolean {
  return a.deliverAtMs !== b.deliverAtMs ? a.deliverAtMs < b.deliverAtMs : a.seq < b.seq;
}

/**
 * Applies a spec's imperfections to one sink's delivered copy, one event at a time (R9).
 * `push` takes a truth event and its fraud label; `drainUntil(t)` emits every delivery due by
 * simulated time `t`, in delivery order; `flush()` emits the rest. The truth event is never
 * mutated — payloads are copies — and every imperfection produces its own label so the answer
 * key can enumerate it.
 *
 * - **late**: the delivery waits in a min-heap until the simulated clock passes `ts + delay`.
 *   Its payload `ts` stays the event time; `delivered_at` carries the arrival time.
 * - **clock_skew**: the source's offset is added to the payload `ts`; order is unchanged.
 * - **out_of_order**: a one-slot hold lets the next delivery overtake the flagged one. The label
 *   is written when the overtake actually happens, so a flagged delivery that nothing overtakes
 *   is not mislabelled.
 * - **duplicate**: extra copies follow the primary immediately, each with a fresh `delivery_id`.
 *
 * Each transformer owns an RNG derived from the seed, sink and partition, so adding a sink never
 * perturbs another sink's output or the truth.
 */
export class ImperfectionTransformer {
  private rng: Rng;
  private nextDeliveryId: (seedTimeMs: number) => string;
  private heap: MinHeap<DeliveredDraft>;
  private hold: DeliveredDraft | null = null;
  private seq = 0;

  constructor(
    private readonly sinkName: string,
    private readonly config: ImperfectionsConfig,
    rng: Rng,
    state?: TransformerState,
  ) {
    if (state) {
      // Copied: emitting a delivery appends to its labels in place, and the same checkpoint can
      // be restored again later.
      const owned = structuredClone(state);
      this.rng = restoreRng({ state: owned.rngState });
      this.heap = MinHeap.fromArray(owned.delayHeap, draftBefore);
      this.hold = owned.holdSlot;
      this.seq = owned.seq;
    } else {
      this.rng = rng;
      this.heap = new MinHeap<DeliveredDraft>(draftBefore);
    }
    this.nextDeliveryId = createDeterministicUlid(this.rng);
  }

  /** A transformer with no history, seeded from `rng`. */
  static create(sinkName: string, config: ImperfectionsConfig, rng: Rng): ImperfectionTransformer {
    return new ImperfectionTransformer(sinkName, config, rng);
  }

  /** Rebuilds a transformer from a checkpoint (resume and live-session restore). */
  static restore(
    sinkName: string,
    config: ImperfectionsConfig,
    state: TransformerState,
  ): ImperfectionTransformer {
    return new ImperfectionTransformer(sinkName, config, createRng(0n), state);
  }

  /** Number of deliveries waiting for the clock (late events plus the hold slot). */
  get pending(): number {
    return this.heap.size + (this.hold ? 1 : 0);
  }

  private label(eventId: string): LabelRecord {
    return {
      event_id: eventId,
      is_fraud: false,
      typology: null,
      actor_id: null,
      campaign_step: null,
      corruption_type: null,
      corruption_detail: null,
      sink: this.sinkName,
      delivery_outcome: null,
    };
  }

  push(event: TruthEvent, fraudLabel: LabelRecord): void {
    const { rng, config, sinkName } = this;
    const truthMs = Date.parse(event.ts);
    const base = this.label(event.event_id);
    const corruptions: LabelRecord[] = [];

    let deliverAtMs = truthMs;
    const late = config.late_arrival;
    if (late && appliesToSink(late.sinks, sinkName)) {
      const delayMs = lateArrivalDelayMs(late, rng);
      if (delayMs > 0) {
        deliverAtMs = truthMs + delayMs;
        corruptions.push({
          ...base,
          corruption_type: "late",
          corruption_detail: { delay_ms: delayMs },
        });
      }
    }

    let reportedTs = event.ts;
    const skew = config.clock_skew;
    if (skew && appliesToSink(skew.sinks, sinkName)) {
      const offsetMs = clockSkewOffsetMs(skew, sinkName, rng);
      if (offsetMs !== 0) {
        reportedTs = new Date(truthMs + offsetMs).toISOString();
        corruptions.push({
          ...base,
          corruption_type: "clock_skew",
          corruption_detail: { offset_ms: offsetMs },
        });
      }
    }

    const reorderConfig = config.out_of_order;
    const reorder =
      !!reorderConfig &&
      appliesToSink(reorderConfig.sinks, sinkName) &&
      shouldReorder(reorderConfig, rng);

    const deliveredAt = new Date(deliverAtMs).toISOString();
    const make = (extra: LabelRecord[]): Delivered => {
      const deliveryId = this.nextDeliveryId(deliverAtMs);
      const payload: WirePayload = {
        ...event,
        ts: reportedTs,
        delivery_id: deliveryId,
        delivered_at: deliveredAt,
        sent_at: null,
      };
      return {
        delivery_id: deliveryId,
        event_id: event.event_id,
        sink: sinkName,
        payload,
        fraudLabel,
        corruptions: extra,
      };
    };

    const items: Delivered[] = [make(corruptions)];
    const dup = config.duplicate_delivery;
    if (dup && appliesToSink(dup.sinks, sinkName)) {
      const extras = extraDuplicateCount(dup, rng);
      for (let ordinal = 1; ordinal <= extras; ordinal++) {
        items.push(
          make([{ ...base, corruption_type: "duplicate", corruption_detail: { ordinal } }]),
        );
      }
    }

    this.heap.push({ deliverAtMs, seq: this.seq++, items, reorder });
  }

  /** Emits every delivery whose simulated arrival time is at or before `simTimeMs`. */
  drainUntil(simTimeMs: number): Delivered[] {
    const out: Delivered[] = [];
    for (;;) {
      const next = this.heap.peek();
      if (!next || next.deliverAtMs > simTimeMs) break;
      this.emit(this.heap.pop()!, out);
    }
    return out;
  }

  /** Emits everything still pending — the end of history or a stopped stream. */
  flush(): Delivered[] {
    const out: Delivered[] = [];
    for (let draft = this.heap.pop(); draft; draft = this.heap.pop()) this.emit(draft, out);
    if (this.hold) {
      // Nothing overtook it, so it was delivered in order and carries no out_of_order label.
      for (const item of this.hold.items) out.push(item);
      this.hold = null;
    }
    return out;
  }

  private emit(draft: DeliveredDraft, out: Delivered[]): void {
    const held = this.hold;
    if (held) {
      // The successor goes first; the held delivery is now genuinely out of order.
      for (const item of draft.items) out.push(item);
      const primary = held.items[0]!;
      primary.corruptions.push({
        ...this.label(primary.event_id),
        corruption_type: "out_of_order",
        corruption_detail: null,
      });
      for (const item of held.items) out.push(item);
      this.hold = null;
    } else if (draft.reorder) {
      this.hold = draft;
    } else {
      for (const item of draft.items) out.push(item);
    }
  }

  checkpoint(): TransformerState {
    return {
      rngState: [...this.rng.checkpoint().state],
      seq: this.seq,
      delayHeap: structuredClone(this.heap.toArray()),
      holdSlot: this.hold ? structuredClone(this.hold) : null,
    };
  }
}
