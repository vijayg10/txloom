import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn.js";

export const Select = forwardRef<HTMLSelectElement, React.ComponentPropsWithoutRef<"select">>(
  ({ className, children, ...rest }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "border-border bg-card text-text focus:border-primary focus:ring-primary/30 disabled:bg-hover disabled:text-muted h-11 w-full appearance-none rounded-xl border px-3.5 pr-9 text-sm focus:ring-2 focus:outline-none disabled:cursor-not-allowed",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className="text-muted pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2"
        aria-hidden="true"
      />
    </div>
  ),
);
Select.displayName = "Select";
