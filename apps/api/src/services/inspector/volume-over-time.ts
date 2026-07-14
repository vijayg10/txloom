import type { SeasonalityWindow } from "@txloom/spec";
import type { TruthEvent } from "@txloom/engine";

export interface VolumeOverTimePoint {
  date: string;
  count: number;
}

export interface VolumeOverTimeResult {
  points: VolumeOverTimePoint[];
  seasonality: readonly SeasonalityWindow[];
}

/** Daily event counts with the spec's seasonality windows attached so the UI
 * can overlay them (FR-036 §4). */
export function computeVolumeOverTime(
  events: readonly TruthEvent[],
  seasonality: readonly SeasonalityWindow[],
): VolumeOverTimeResult {
  const counts = new Map<string, number>();
  for (const event of events) {
    const date = event.ts.slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const points = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
  return { points, seasonality };
}
