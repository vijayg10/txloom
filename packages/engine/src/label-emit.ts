import type { LabelRecord, TruthEvent } from "./types.js";

/** Combines a partition's fraud/legit labels (from truth-emit.ts) with the
 * corruption labels produced later by the imperfections pipeline into the
 * final answer key for `runs/<run_id>/labels/` (FR-021). */
export function mergeLabelRecords(
  baseLabels: readonly LabelRecord[],
  corruptionLabels: readonly LabelRecord[],
): LabelRecord[] {
  return [...baseLabels, ...corruptionLabels];
}

/** Every label must reference a real truth event — the reconciliation
 * guarantee the Independent Test for US1 checks (labels reconcile with data). */
export function assertLabelsReconcile(
  truthEvents: readonly TruthEvent[],
  labels: readonly LabelRecord[],
): void {
  const eventIds = new Set(truthEvents.map((e) => e.event_id));
  for (const label of labels) {
    if (!eventIds.has(label.event_id)) {
      throw new Error(`Label references unknown event_id "${label.event_id}"`);
    }
  }
}
