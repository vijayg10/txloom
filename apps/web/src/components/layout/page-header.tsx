import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  meta?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, meta, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-text text-[32px] leading-tight font-bold">{title}</h2>
        {meta ? <p className="text-text-secondary mt-1 text-sm">{meta}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}
