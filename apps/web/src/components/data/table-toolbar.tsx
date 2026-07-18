import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { Button } from "../ui/button.js";
import { SearchInput } from "../ui/search-input.js";

interface TableToolbarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  onExport?: () => void;
  children?: ReactNode;
}

export function TableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  onExport,
  children,
}: TableToolbarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {onSearchChange ? (
        <div className="min-w-[220px] flex-1">
          <SearchInput
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {filters}
        {children}
        {onExport ? (
          <Button variant="secondary" onClick={onExport}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export
          </Button>
        ) : null}
      </div>
    </div>
  );
}
