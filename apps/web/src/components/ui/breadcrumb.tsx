import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="text-text-secondary flex items-center gap-1.5 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          let content: ReactNode = item.label;
          if (item.href && !isLast) {
            content = (
              <Link to={item.href} className="hover:text-text">
                {item.label}
              </Link>
            );
          } else if (isLast) {
            content = <span className="text-text font-medium">{item.label}</span>;
          }
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight className="text-muted h-3.5 w-3.5" aria-hidden="true" />
              ) : null}
              {content}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
