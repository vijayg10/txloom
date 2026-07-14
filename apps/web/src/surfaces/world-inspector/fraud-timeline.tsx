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

  if (!points) return <p>Loading fraud timeline…</p>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Legend />
        {typologies.map((typology, i) => (
          <Line
            key={typology}
            type="monotone"
            dataKey={typology}
            stroke={["#6ea8fe", "#f5a623", "#e85d75"][i % 3]}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
