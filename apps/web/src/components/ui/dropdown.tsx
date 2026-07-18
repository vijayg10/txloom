import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/cn.js";

export const Dropdown = RadixDropdown.Root;
export const DropdownTrigger = RadixDropdown.Trigger;

export function DropdownContent({
  className,
  align = "end",
  sideOffset = 6,
  ...rest
}: React.ComponentPropsWithoutRef<typeof RadixDropdown.Content>) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "border-border bg-card z-50 min-w-[180px] rounded-xl border p-1.5 shadow-lg",
          "data-[state=open]:animate-fade-scale-in data-[state=closed]:animate-fade-scale-out",
          className,
        )}
        {...rest}
      />
    </RadixDropdown.Portal>
  );
}

export function DropdownItem({
  className,
  ...rest
}: React.ComponentPropsWithoutRef<typeof RadixDropdown.Item>) {
  return (
    <RadixDropdown.Item
      className={cn(
        "text-text data-[highlighted]:bg-hover flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors duration-200 outline-none",
        className,
      )}
      {...rest}
    />
  );
}
