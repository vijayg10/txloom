import { forwardRef } from "react";
import { cn } from "@/lib/cn.js";

export interface InputProps extends React.ComponentPropsWithoutRef<"input"> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(
        "border-border bg-card text-text placeholder:text-muted focus:border-primary focus:ring-primary/30 disabled:bg-hover disabled:text-muted h-11 w-full rounded-xl border px-3.5 text-sm focus:ring-2 focus:outline-none disabled:cursor-not-allowed",
        invalid && "border-danger focus:border-danger focus:ring-danger/30",
        className,
      )}
      {...rest}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea"> & { invalid?: boolean }
>(({ className, invalid, ...rest }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "border-border bg-card text-text placeholder:text-muted focus:border-primary focus:ring-primary/30 disabled:bg-hover disabled:text-muted w-full rounded-xl border px-3.5 py-2.5 text-sm focus:ring-2 focus:outline-none disabled:cursor-not-allowed",
      invalid && "border-danger focus:border-danger focus:ring-danger/30",
      className,
    )}
    {...rest}
  />
));
Textarea.displayName = "Textarea";
