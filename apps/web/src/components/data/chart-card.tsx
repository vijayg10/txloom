import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/card.js";

// Hex values mirror the Tailwind theme tokens in index.css — recharts renders to
// SVG/canvas and can't reliably resolve Tailwind utility classes, so chart series
// colors are centralized here instead of being hardcoded per-chart.
export const CHART_COLORS = {
  primary: "#16A34A",
  info: "#2563EB",
  warning: "#D97706",
  danger: "#EF4444",
  muted: "#9CA3AF",
  series: ["#16A34A", "#2563EB", "#D97706", "#EF4444", "#7C3AED"],
  grid: "#E5E7EB",
  axis: "#6B7280",
} as const;

interface ChartCardProps {
  title: string;
  action?: ReactNode;
  height?: number;
  children: ReactNode;
}

export function ChartCard({ title, action, height = 280, children }: ChartCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardBody style={{ height }}>{children}</CardBody>
    </Card>
  );
}
