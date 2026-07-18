import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { apiClient } from "../../api/client.js";
import { CHART_COLORS } from "../../components/data/chart-card.js";

interface AmountDistributionBucket {
  group: string;
  count: number;
  mean: number;
  stddev: number;
}

/** Amount distribution per event-type bucket (FR-036 §4). */
export function AmountDistributions({ runId }: { runId: string }) {
  const [buckets, setBuckets] = useState<AmountDistributionBucket[] | null>(null);

  useEffect(() => {
    apiClient
      .get<{ buckets: AmountDistributionBucket[] }>(`/runs/${runId}/inspector/amount-distributions`)
      .then((res) => setBuckets(res.buckets))
      .catch(() => setBuckets(null));
  }, [runId]);

  if (!buckets) return <p className="text-text-secondary text-sm">Loading amount distributions…</p>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={buckets}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis dataKey="group" stroke={CHART_COLORS.axis} fontSize={12} tickLine={false} />
        <YAxis stroke={CHART_COLORS.axis} fontSize={12} tickLine={false} />
        <Tooltip />
        <Bar dataKey="mean" fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
