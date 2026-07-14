import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { apiClient } from "../../api/client.js";

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

  if (!buckets) return <p>Loading amount distributions…</p>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={buckets}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="group" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="mean" fill="#6ea8fe" />
      </BarChart>
    </ResponsiveContainer>
  );
}
