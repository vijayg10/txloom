import { forwardRef } from "react";
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn.js";

export const Checkbox = forwardRef<
  React.ElementRef<typeof RadixCheckbox.Root>,
  React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root>
>(({ className, ...rest }, ref) => (
  <RadixCheckbox.Root
    ref={ref}
    className={cn(
      "border-border bg-card data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:ring-primary/40 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...rest}
  >
    <RadixCheckbox.Indicator className="text-white">
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </RadixCheckbox.Indicator>
  </RadixCheckbox.Root>
));
Checkbox.displayName = "Checkbox";
