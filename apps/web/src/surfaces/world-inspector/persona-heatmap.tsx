import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

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

  if (!cells) return <p>Loading persona heatmap…</p>;

  const max = Math.max(1, ...cells.map((c) => c.count));

  return (
    <table className="persona-heatmap">
      <tbody>
        {DAY_LABELS.map((label, dayOfWeek) => (
          <tr key={label}>
            <th>{label}</th>
            {Array.from({ length: 24 }, (_, hourOfDay) => {
              const cell = cells.find(
                (c) => c.dayOfWeek === dayOfWeek && c.hourOfDay === hourOfDay,
              );
              const intensity = (cell?.count ?? 0) / max;
              return (
                <td
                  key={hourOfDay}
                  title={`${label} ${hourOfDay}:00 — ${cell?.count ?? 0} events`}
                  style={{ backgroundColor: `rgba(110, 168, 254, ${intensity})` }}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
