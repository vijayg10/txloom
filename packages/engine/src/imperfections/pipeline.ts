import type { ImperfectionsConfig, OutputSinkRef } from "@txloom/spec";
import type { Rng } from "../rng.js";
import { createDeterministicUlid } from "../id.js";
import { extraDuplicateCount } from "./duplicate.js";
import { lateArrivalDelayMs } from "./late-arrival.js";
import { shouldReorder } from "./out-of-order.js";
import { clockSkewOffsetMs } from "./clock-skew.js";
import type { TruthEvent, DeliveredEvent, LabelRecord } from "../types.js";

function appliesToSink(sinks: string[] | undefined, sinkName: string): boolean {
  return !sinks || sinks.length === 0 || sinks.includes(sinkName);
}

/**
 * Projects truth events onto each configured output sink, applying configured
 * imperfections to the *delivered* copies only — the truth record passed in is
 * never mutated (constitution Principle II, FR-024/025). Every corruption gets
 * its own LabelRecord row so the answer key enumerates it.
 */
export function applyImperfections(
  truthEvents: readonly TruthEvent[],
  sinks: readonly OutputSinkRef[],
  imperfections: ImperfectionsConfig,
  rng: Rng,
): { deliveredEvents: DeliveredEvent[]; corruptionLabels: LabelRecord[] } {
  const nextDeliveryId = createDeterministicUlid(rng);
  const deliveredEvents: DeliveredEvent[] = [];
  const corruptionLabels: LabelRecord[] = [];

  for (const sink of sinks) {
    const sinkName = sink.name;
    const perSinkDelivered: DeliveredEvent[] = [];
    const reorderFlags: boolean[] = [];
    // Index into perSinkDelivered of each event's *primary* delivery — duplicates
    // append extra entries after it, so reorder swaps must target this index, not
    // the truth-event loop position.
    const primaryDeliveryIndex: number[] = [];

    for (const event of truthEvents) {
      const { partition_no: _partitionNo, ...payload } = event;
      let deliveredTs = event.ts;
      const label: LabelRecord = {
        event_id: event.event_id,
        is_fraud: false,
        typology: null,
        actor_id: null,
        campaign_step: null,
        corruption_type: null,
        corruption_detail: null,
        sink: sinkName,
      };

      const lateConfig = imperfections.late_arrival;
      if (lateConfig && appliesToSink(lateConfig.sinks, sinkName)) {
        const delayMs = lateArrivalDelayMs(lateConfig, rng);
        if (delayMs > 0) {
          deliveredTs = new Date(Date.parse(event.ts) + delayMs).toISOString();
          corruptionLabels.push({
            ...label,
            corruption_type: "late",
            corruption_detail: { delay_ms: delayMs },
          });
        }
      }

      const skewConfig = imperfections.clock_skew;
      if (skewConfig && appliesToSink(skewConfig.sinks, sinkName)) {
        const offsetMs = clockSkewOffsetMs(skewConfig, sinkName, rng);
        if (offsetMs !== 0) {
          deliveredTs = new Date(Date.parse(deliveredTs) + offsetMs).toISOString();
          corruptionLabels.push({
            ...label,
            corruption_type: "clock_skew",
            corruption_detail: { offset_ms: offsetMs },
          });
        }
      }

      const reorderConfig = imperfections.out_of_order;
      const willReorder =
        !!reorderConfig &&
        appliesToSink(reorderConfig.sinks, sinkName) &&
        shouldReorder(reorderConfig, rng);
      if (willReorder) {
        corruptionLabels.push({
          ...label,
          corruption_type: "out_of_order",
          corruption_detail: null,
        });
      }
      reorderFlags.push(willReorder);

      const primaryDelivery: DeliveredEvent = {
        delivery_id: nextDeliveryId(Date.parse(deliveredTs)),
        event_id: event.event_id,
        ts: deliveredTs,
        sink: sinkName,
        payload,
      };
      primaryDeliveryIndex.push(perSinkDelivered.length);
      perSinkDelivered.push(primaryDelivery);

      const duplicateConfig = imperfections.duplicate_delivery;
      if (duplicateConfig && appliesToSink(duplicateConfig.sinks, sinkName)) {
        const extras = extraDuplicateCount(duplicateConfig, rng);
        for (let ordinal = 1; ordinal <= extras; ordinal++) {
          perSinkDelivered.push({
            delivery_id: nextDeliveryId(Date.parse(deliveredTs)),
            event_id: event.event_id,
            ts: deliveredTs,
            sink: sinkName,
            payload,
          });
          corruptionLabels.push({
            ...label,
            corruption_type: "duplicate",
            corruption_detail: { ordinal },
          });
        }
      }
    }

    // Out-of-order: swap each flagged event's primary delivery with its
    // successor's in the delivered stream — the truth store retains
    // chronological order; only this sink's delivered stream is disturbed.
    for (let i = 0; i < reorderFlags.length - 1; i++) {
      if (reorderFlags[i]) {
        const a = primaryDeliveryIndex[i]!;
        const b = primaryDeliveryIndex[i + 1]!;
        const tmp = perSinkDelivered[a]!;
        perSinkDelivered[a] = perSinkDelivered[b]!;
        perSinkDelivered[b] = tmp;
      }
    }

    deliveredEvents.push(...perSinkDelivered);
  }

  return { deliveredEvents, corruptionLabels };
}
