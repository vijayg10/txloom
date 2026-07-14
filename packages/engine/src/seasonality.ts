import type { SeasonalityWindow } from "@txloom/spec";

/** Combined volume multiplier for `date` across every seasonality window whose
 * range includes it — multipliers stack when windows overlap. */
export function seasonalityMultiplier(windows: readonly SeasonalityWindow[], date: Date): number {
  let multiplier = 1;
  for (const window of windows) {
    const start = new Date(`${window.window[0]}T00:00:00.000Z`);
    const end = new Date(`${window.window[1]}T23:59:59.999Z`);
    if (date >= start && date <= end) {
      multiplier *= window.volume_multiplier;
    }
  }
  return multiplier;
}
