import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="border-border flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
      <Icon className="text-muted h-8 w-8" aria-hidden="true" />
      <p className="text-text text-sm font-medium">{title}</p>
      {description ? <p className="text-text-secondary max-w-sm text-sm">{description}</p> : null}
      {action}
    </div>
  );
}
