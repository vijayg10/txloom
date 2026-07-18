import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { heatmapColor } from "../../lib/heatmap-color.js";

interface HeatmapCell {
  dayOfWeek: number;
  hourOfDay: number;
  count: number;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Persona activity heatmap: day-of-week × hour-of-day grid (FR-036 §4). */
export function PersonaHeatmap({ runId }: { runId: string }) {
  const [cells, setCells] = useState<HeatmapCell[] | null>(null);

  useEffect(() => {
    apiClient
      .get<{ cells: HeatmapCell[] }>(`/runs/${runId}/inspector/persona-heatmap`)
      .then((res) => setCells(res.cells))
      .catch(() => setCells(null));
  }, [runId]);

  if (!cells) return <p className="text-text-secondary text-sm">Loading persona heatmap…</p>;

  const max = Math.max(1, ...cells.map((c) => c.count));

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1">
        <tbody>
          {DAY_LABELS.map((label, dayOfWeek) => (
            <tr key={label}>
              <th className="text-text-secondary pr-2 text-right text-xs font-medium">{label}</th>
              {Array.from({ length: 24 }, (_, hourOfDay) => {
                const cell = cells.find(
                  (c) => c.dayOfWeek === dayOfWeek && c.hourOfDay === hourOfDay,
                );
                const intensity = (cell?.count ?? 0) / max;
                return (
                  <td
                    key={hourOfDay}
                    title={`${label} ${hourOfDay}:00 — ${cell?.count ?? 0} events`}
                    className="h-4 w-4 rounded-sm"
                    style={{ backgroundColor: heatmapColor(intensity) }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
