import { describe, expect, it } from "vitest";
import {
  generatePartition,
  generateMerchantPool,
  resumeLiveWorld,
  drawNextLiveEvent,
} from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

/** SC-006: the live-stream phase continues the SAME world (population + RNG
 * stream) the history phase produced — no reset, no discontinuity. */
describe("history -> live continuity (SC-006)", () => {
  it("the live world's consumer population is byte-identical to history's", () => {
    const spec = referenceScenarioSpec();
    const seed = BigInt(spec.seed);
    const merchants = generateMerchantPool(spec, seed);

    const history = generatePartition(spec, seed, 0, 1, merchants);
    const live = resumeLiveWorld(spec, seed, 0, 1, merchants);

    expect(live.consumers).toEqual(history.worldCheckpoint.consumers);
  });

  it("live events continue the RNG stream forward — none collide with history's event ids", () => {
    const spec = referenceScenarioSpec();
    const seed = BigInt(spec.seed);
    const merchants = generateMerchantPool(spec, seed);

    const history = generatePartition(spec, seed, 0, 1, merchants);
    const historyIds = new Set(history.truthEvents.map((e) => e.event_id));

    const live = resumeLiveWorld(spec, seed, 0, 1, merchants);
    const liveEventIds = Array.from(
      { length: 25 },
      (_, i) =>
        drawNextLiveEvent(spec, live, 0, Date.parse("2026-02-01T00:00:00.000Z") + i * 1000)
          .event_id,
    );

    for (const id of liveEventIds) {
      expect(historyIds.has(id)).toBe(false);
    }
    // Continuation must also produce fresh draws, not a repeating cycle.
    expect(new Set(liveEventIds).size).toBe(liveEventIds.length);
  });

  it("resuming from the same seed+spec twice draws identical subsequent live events (determinism)", () => {
    const spec = referenceScenarioSpec();
    const seed = BigInt(spec.seed);
    const merchants = generateMerchantPool(spec, seed);

    const worldA = resumeLiveWorld(spec, seed, 0, 1, merchants);
    const worldB = resumeLiveWorld(spec, seed, 0, 1, merchants);

    const nowMs = Date.parse("2026-02-01T00:00:00.000Z");
    const eventsA = Array.from({ length: 10 }, (_, i) =>
      drawNextLiveEvent(spec, worldA, 0, nowMs + i),
    );
    const eventsB = Array.from({ length: 10 }, (_, i) =>
      drawNextLiveEvent(spec, worldB, 0, nowMs + i),
    );

    expect(eventsA).toEqual(eventsB);
  });
});
