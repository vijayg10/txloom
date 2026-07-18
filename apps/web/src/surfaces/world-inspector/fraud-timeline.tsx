import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { apiClient } from "../../api/client.js";
import { CHART_COLORS } from "../../components/data/chart-card.js";

interface FraudTimelinePoint {
  date: string;
  typology: string;
  count: number;
}

/** Fraud-injection timeline, one line per typology (FR-036 §4). */
export function FraudTimeline({ runId }: { runId: string }) {
  const [points, setPoints] = useState<FraudTimelinePoint[] | null>(null);

  useEffect(() => {
    apiClient
      .get<{ points: FraudTimelinePoint[] }>(`/runs/${runId}/inspector/fraud-timeline`)
      .then((res) => setPoints(res.points))
      .catch(() => setPoints(null));
  }, [runId]);

  const { rows, typologies } = useMemo(() => {
    if (!points) return { rows: [], typologies: [] };
    const typologySet = new Set(points.map((p) => p.typology));
    const byDate = new Map<string, Record<string, number>>();
    for (const point of points) {
      const row = byDate.get(point.date) ?? {};
      row[point.typology] = point.count;
      byDate.set(point.date, row);
    }
    const rows = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));
    return { rows, typologies: [...typologySet] };
  }, [points]);

  if (!points) return <p className="text-text-secondary text-sm">Loading fraud timeline…</p>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis dataKey="date" stroke={CHART_COLORS.axis} fontSize={12} tickLine={false} />
        <YAxis stroke={CHART_COLORS.axis} fontSize={12} tickLine={false} />
        <Tooltip />
        <Legend />
        {typologies.map((typology, i) => (
          <Line
            key={typology}
            type="monotone"
            dataKey={typology}
            stroke={CHART_COLORS.series[i % CHART_COLORS.series.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
