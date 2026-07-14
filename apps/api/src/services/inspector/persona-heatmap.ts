import type { TruthEvent } from "@txloom/engine";

export interface HeatmapCell {
  dayOfWeek: number; // 0 = Sunday
  hourOfDay: number; // 0-23, UTC (virtual-clock time — never wall-clock)
  count: number;
}

/** 7×24 activity grid (day-of-week × hour-of-day) — the persona activity
 * heatmap (FR-036 §4). */
export function computePersonaHeatmap(events: readonly TruthEvent[]): HeatmapCell[] {
  const grid = new Map<string, number>();
  for (const event of events) {
    const date = new Date(event.ts);
    const key = `${date.getUTCDay()}:${date.getUTCHours()}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }

  const cells: HeatmapCell[] = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    for (let hourOfDay = 0; hourOfDay < 24; hourOfDay++) {
      cells.push({ dayOfWeek, hourOfDay, count: grid.get(`${dayOfWeek}:${hourOfDay}`) ?? 0 });
    }
  }
  return cells;
}
