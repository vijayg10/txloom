import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/cn.js";

export type ToastTone = "success" | "danger" | "neutral";

interface ToastProps {
  tone?: ToastTone;
  message: string;
  onDismiss?: () => void;
}

const TONE_ICON = {
  success: CheckCircle2,
  danger: AlertCircle,
  neutral: null,
};

export function Toast({ tone = "neutral", message, onDismiss }: ToastProps) {
  const Icon = TONE_ICON[tone];
  return createPortal(
    <div
      role="status"
      className={cn(
        "border-border bg-card text-text fixed right-6 bottom-6 z-[60] flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg",
        tone === "success" && "border-success/30",
        tone === "danger" && "border-danger/30",
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "h-4 w-4",
            tone === "success" && "text-success",
            tone === "danger" && "text-danger",
          )}
          aria-hidden="true"
        />
      ) : null}
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted hover:text-text ml-2"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
