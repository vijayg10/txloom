import { forwardRef } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn.js";

export const SearchInput = forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<"input">>(
  ({ className, ...rest }, ref) => (
    <div className="relative">
      <Search
        className="text-muted pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <input
        ref={ref}
        type="search"
        className={cn(
          "bg-hover text-text placeholder:text-muted focus:border-primary focus:bg-card focus:ring-primary/30 h-11 w-full min-w-0 rounded-full border border-transparent pr-4 pl-10 text-sm focus:ring-2 focus:outline-none",
          className,
        )}
        {...rest}
      />
    </div>
  ),
);
SearchInput.displayName = "SearchInput";
