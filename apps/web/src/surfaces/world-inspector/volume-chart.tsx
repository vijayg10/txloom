import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { apiClient } from "../../api/client.js";
import { CHART_COLORS } from "../../components/data/chart-card.js";

interface VolumeOverTimeResult {
  points: { date: string; count: number }[];
  seasonality: { event: string; window: [string, string]; volume_multiplier: number }[];
}

/** Volume-over-time with a seasonality-window overlay (FR-036 §4). */
export function VolumeChart({ runId }: { runId: string }) {
  const [data, setData] = useState<VolumeOverTimeResult | null>(null);

  useEffect(() => {
    apiClient
      .get<VolumeOverTimeResult>(`/runs/${runId}/inspector/volume-over-time`)
      .then(setData)
      .catch(() => setData(null));
  }, [runId]);

  if (!data) return <p className="text-text-secondary text-sm">Loading volume…</p>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data.points}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis dataKey="date" stroke={CHART_COLORS.axis} fontSize={12} tickLine={false} />
        <YAxis stroke={CHART_COLORS.axis} fontSize={12} tickLine={false} />
        <Tooltip />
        {data.seasonality.map((window) => (
          <ReferenceArea
            key={window.event}
            x1={window.window[0]}
            x2={window.window[1]}
            label={window.event}
            fillOpacity={0.1}
          />
        ))}
        <Line
          type="monotone"
          dataKey="count"
          stroke={CHART_COLORS.primary}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
