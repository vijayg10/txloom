import { useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Filter } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { SearchInput } from "../ui/search-input.js";

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterMenuProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function FilterMenu({ label, options, selected, onChange }: FilterMenuProps) {
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(query.toLowerCase()),
  );

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>
        <Button variant="secondary">
          <Filter className="h-4 w-4" aria-hidden="true" />
          {label}
          {selected.length > 0 ? (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-xs text-primary">
              {selected.length}
            </span>
          ) : null}
        </Button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={8}
          className={cn(
            "z-50 w-64 rounded-xl border border-border bg-card p-3 shadow-lg",
            "data-[state=open]:animate-fade-scale-in data-[state=closed]:animate-fade-scale-out",
          )}
        >
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${label.toLowerCase()}…`}
            aria-label={`Search ${label.toLowerCase()}`}
            className="mb-2"
          />
          <ul className="max-h-60 overflow-y-auto">
            {filtered.map((option) => (
              <li key={option.value}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-text hover:bg-hover">
                  <Checkbox
                    checked={selected.includes(option.value)}
                    onCheckedChange={() => toggle(option.value)}
                  />
                  {option.label}
                </label>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-sm text-muted">No matches</li>
            ) : null}
          </ul>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
