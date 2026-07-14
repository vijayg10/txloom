export interface PartitionRange {
  partitionNo: number;
  /** Inclusive start index into the flat consumer population. */
  start: number;
  /** Exclusive end index. */
  end: number;
}

/** Deterministic slice of the consumer index space across `partitionCount`
 * workers (FR-013/018) — a pure function of (consumerCount, partitionCount),
 * unaffected by execution order or concurrency. */
export function computeConsumerPartitions(
  consumerCount: number,
  partitionCount: number,
): PartitionRange[] {
  if (partitionCount < 1) throw new Error("partitionCount must be >= 1");
  const base = Math.floor(consumerCount / partitionCount);
  const remainder = consumerCount % partitionCount;
  const ranges: PartitionRange[] = [];
  let cursor = 0;
  for (let p = 0; p < partitionCount; p++) {
    const size = base + (p < remainder ? 1 : 0);
    ranges.push({ partitionNo: p, start: cursor, end: cursor + size });
    cursor += size;
  }
  return ranges;
}

/** Chunk size-driven default partition count — ~20k consumers per partition. */
export function defaultPartitionCount(consumerCount: number, chunkSize = 20_000): number {
  return Math.max(1, Math.ceil(consumerCount / chunkSize));
}
