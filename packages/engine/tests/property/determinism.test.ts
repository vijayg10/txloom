import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { generatePartition, generateMerchantPool } from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

function sortById<T extends { event_id: string }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.event_id.localeCompare(b.event_id));
}

/** SC-001: identical spec+seed produces byte-identical output regardless of how
 * generation is chunked/ordered across partitions — each partition is a pure
 * function of (spec, seed, partitionNo, partitionCount), independent of the
 * others, so "parallel" (any execution/merge order) and "sequential" merges
 * to the same result. */
describe("determinism under parallel partitioning (SC-001)", () => {
  it.each([1, 2, 3, 5])(
    "merges to the same event set regardless of partition-merge order (partitionCount=%i)",
    (partitionCount) => {
      const spec = referenceScenarioSpec();
      const seed = BigInt(spec.seed);
      const merchants = generateMerchantPool(spec, seed);

      const sequential = Array.from({ length: partitionCount }, (_, p) =>
        generatePartition(spec, seed, p, partitionCount, merchants),
      );
      const sequentialEvents = sortById(sequential.flatMap((r) => r.truthEvents));

      // "Parallel" merge order: generate the same partitions in reverse.
      const reversed = Array.from({ length: partitionCount }, (_, i) => partitionCount - 1 - i).map(
        (p) => generatePartition(spec, seed, p, partitionCount, merchants),
      );
      const reversedEvents = sortById(reversed.flatMap((r) => r.truthEvents));

      expect(reversedEvents).toEqual(sequentialEvents);
    },
  );

  it("property: any shuffled partition-generation order merges to the same event set", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(2, 3, 4),
        fc.integer({ min: 0, max: 1000 }),
        (partitionCount, shuffleSeed) => {
          const spec = referenceScenarioSpec();
          const seed = BigInt(spec.seed);
          const merchants = generateMerchantPool(spec, seed);

          const order = Array.from({ length: partitionCount }, (_, i) => i);
          // Deterministic shuffle from shuffleSeed — fast-check needs a pure property.
          for (let i = order.length - 1; i > 0; i--) {
            const j = (shuffleSeed * (i + 7)) % (i + 1);
            [order[i], order[j]] = [order[j]!, order[i]!];
          }

          const inOrder = Array.from({ length: partitionCount }, (_, p) =>
            generatePartition(spec, seed, p, partitionCount, merchants),
          );
          const shuffled = order.map((p) =>
            generatePartition(spec, seed, p, partitionCount, merchants),
          );

          expect(sortById(shuffled.flatMap((r) => r.truthEvents))).toEqual(
            sortById(inOrder.flatMap((r) => r.truthEvents)),
          );
        },
      ),
      { numRuns: 15 },
    );
  });

  it("identical seed+spec, re-run twice, produces byte-identical output for a single partition", () => {
    const spec = referenceScenarioSpec();
    const seed = BigInt(spec.seed);
    const merchants = generateMerchantPool(spec, seed);

    const run1 = generatePartition(spec, seed, 0, 1, merchants);
    const run2 = generatePartition(spec, seed, 0, 1, merchants);

    expect(run1.truthEvents).toEqual(run2.truthEvents);
    expect(run1.labelRecords).toEqual(run2.labelRecords);
  });
});
