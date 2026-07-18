import { cn } from "@/lib/cn.js";
import type { RunStatus } from "../../surfaces/run-control/run-status.js";
import type { StreamState } from "../../surfaces/stream-console/stream-state.js";

export type BadgeTone = "success" | "danger" | "warning" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
  warning: "bg-amber-500/10 text-amber-600",
  info: "bg-blue-500/10 text-blue-600",
  neutral: "bg-hover text-text-secondary",
};

export interface StatusBadgeProps extends React.ComponentPropsWithoutRef<"span"> {
  tone: BadgeTone;
}

export function StatusBadge({ tone, className, children, ...rest }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize",
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

const RUN_STATUS_TONE: Record<RunStatus, BadgeTone> = {
  queued: "neutral",
  running: "info",
  paused: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export function runStatusTone(status: RunStatus): BadgeTone {
  return RUN_STATUS_TONE[status];
}

const STREAM_STATE_TONE: Record<StreamState, BadgeTone> = {
  idle: "neutral",
  streaming: "info",
  paused: "warning",
  stopped: "neutral",
};

export function streamStateTone(state: StreamState): BadgeTone {
  return STREAM_STATE_TONE[state];
}

export function booleanTone(value: boolean | null | undefined): BadgeTone {
  if (value === null || value === undefined) return "neutral";
  return value ? "success" : "danger";
}
