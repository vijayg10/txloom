import type { InvariantFn } from "../types.js";
import { toPointer } from "../json-pointer.js";

function addDays(iso: string, days: number): Date {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Every seasonality window must intersect [clock.start, clock.start + clock.days). */
export const seasonalityWindowInvariant: InvariantFn = (spec) => {
  const clockStart = new Date(`${spec.clock.start}T00:00:00.000Z`);
  const clockEnd = addDays(spec.clock.start, spec.clock.days);

  return spec.seasonality.flatMap((window, index) => {
    const [startISO, endISO] = window.window;
    const windowStart = new Date(`${startISO}T00:00:00.000Z`);
    const windowEnd = new Date(`${endISO}T00:00:00.000Z`);

    const intersects = windowStart < clockEnd && windowEnd > clockStart;
    if (intersects) return [];

    return [
      {
        path: toPointer(["seasonality", index, "window"]),
        code: "seasonality-window-outside-clock",
        message:
          `Seasonality window "${window.event}" (${startISO}..${endISO}) does not intersect ` +
          `the clock window (${spec.clock.start}..${clockEnd.toISOString().slice(0, 10)}). ` +
          `Move the window inside the clock range or extend clock.days.`,
      },
    ];
  });
};
