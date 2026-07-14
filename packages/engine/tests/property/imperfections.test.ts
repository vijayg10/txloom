import { describe, expect, it } from "vitest";
import {
  applyImperfections,
  derivePartitionRng,
  generateMerchantPool,
  generatePartition,
} from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

/** FR-024/025: imperfections corrupt only the delivered copy — the truth record
 * is immutable — and every corruption is enumerated in the answer key. */
describe("imperfections corrupt only delivered copies (FR-024/025)", () => {
  const spec = referenceScenarioSpec();
  const seed = BigInt(spec.seed);
  const merchants = generateMerchantPool(spec, seed);
  const { truthEvents } = generatePartition(spec, seed, 0, 1, merchants);
  const truthSnapshotJson = JSON.stringify(truthEvents);

  const deliveryRng = derivePartitionRng(seed, 999);
  const { deliveredEvents, corruptionLabels } = applyImperfections(
    truthEvents,
    spec.output.sinks,
    spec.imperfections,
    deliveryRng,
  );

  it("never mutates the truth events passed in", () => {
    expect(JSON.stringify(truthEvents)).toBe(truthSnapshotJson);
  });

  it("produces at least one corruption of each configured type", () => {
    const types = new Set(corruptionLabels.map((l) => l.corruption_type));
    expect(types.has("duplicate")).toBe(true);
    expect(types.has("late")).toBe(true);
    expect(types.has("out_of_order")).toBe(true);
    expect(types.has("clock_skew")).toBe(true);
  });

  it("every corruption label references a real truth event", () => {
    const truthIds = new Set(truthEvents.map((e) => e.event_id));
    for (const label of corruptionLabels) {
      expect(truthIds.has(label.event_id)).toBe(true);
    }
  });

  it("duplicate corruptions produce more than one delivered copy for that event on that sink", () => {
    const duplicateLabels = corruptionLabels.filter((l) => l.corruption_type === "duplicate");
    expect(duplicateLabels.length).toBeGreaterThan(0);
    for (const label of duplicateLabels.slice(0, 10)) {
      const copies = deliveredEvents.filter(
        (d) => d.event_id === label.event_id && d.sink === label.sink,
      );
      expect(copies.length).toBeGreaterThan(1);
    }
  });

  it("late/clock_skew corruptions shift delivered ts away from truth ts, without touching truth", () => {
    const truthById = new Map(truthEvents.map((e) => [e.event_id, e.ts]));
    const shifted = corruptionLabels.filter(
      (l) => l.corruption_type === "late" || l.corruption_type === "clock_skew",
    );
    expect(shifted.length).toBeGreaterThan(0);
    for (const label of shifted.slice(0, 10)) {
      const delivered = deliveredEvents.find(
        (d) => d.event_id === label.event_id && d.sink === label.sink,
      );
      expect(delivered).toBeDefined();
      expect(delivered!.ts).not.toBe(truthById.get(label.event_id));
    }
  });

  it("delivered event count is at least the truth event count (duplicates only add)", () => {
    expect(deliveredEvents.length).toBeGreaterThanOrEqual(truthEvents.length);
  });
});
