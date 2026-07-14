import type { InvariantFn } from "../types.js";
import { toPointer } from "../json-pointer.js";

/** Reference scale from plan.md § Scale/Scope: 200k consumers / 5k merchants / 90 days,
 * benchmarked to 1,000 TPS sustained to Kafka. Exceeding it is a warning, not a rejection —
 * generation still works, it's just outside the documented/benchmarked envelope. */
export const REFERENCE_SCALE = {
  maxConsumers: 200_000,
  maxMerchants: 5_000,
  maxStreamTps: 1_000,
} as const;

export const scaleEnvelopeInvariant: InvariantFn = (spec) => {
  const violations: ReturnType<InvariantFn> = [];

  if (spec.population.consumers.count > REFERENCE_SCALE.maxConsumers) {
    violations.push({
      path: toPointer(["population", "consumers", "count"]),
      code: "population-above-reference-scale",
      message: `population.consumers.count (${spec.population.consumers.count}) exceeds the documented reference scale (${REFERENCE_SCALE.maxConsumers}). Generation still works but is outside the benchmarked envelope.`,
      severity: "warning",
    });
  }

  if (spec.population.merchants.count > REFERENCE_SCALE.maxMerchants) {
    violations.push({
      path: toPointer(["population", "merchants", "count"]),
      code: "population-above-reference-scale",
      message: `population.merchants.count (${spec.population.merchants.count}) exceeds the documented reference scale (${REFERENCE_SCALE.maxMerchants}). Generation still works but is outside the benchmarked envelope.`,
      severity: "warning",
    });
  }

  const streamTps = spec.clock.then_stream_tps;
  if (streamTps !== undefined && streamTps > REFERENCE_SCALE.maxStreamTps) {
    violations.push({
      path: toPointer(["clock", "then_stream_tps"]),
      code: "stream-tps-above-benchmark",
      message: `clock.then_stream_tps (${streamTps}) exceeds the benchmarked maximum (${REFERENCE_SCALE.maxStreamTps} TPS sustained to Kafka). Sustained delivery above this rate is unverified.`,
      severity: "warning",
    });
  }

  return violations;
};
