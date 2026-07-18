import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn.js";

export type ButtonVariant = "primary" | "secondary" | "icon" | "ghost";

export interface ButtonProps extends React.ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white shadow-sm hover:bg-primary-hover disabled:hover:bg-primary",
  secondary: "border border-border bg-card text-text hover:bg-hover disabled:hover:bg-card",
  ghost: "text-text-secondary hover:bg-hover disabled:hover:bg-transparent",
  icon: "p-0 text-text-secondary hover:bg-hover disabled:hover:bg-transparent",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading = false, disabled, className, children, ...rest }, ref) => {
    const isIcon = variant === "icon";
    return (
      <button
        ref={ref}
        type={rest.type ?? "button"}
        disabled={disabled || loading}
        className={cn(
          "focus-visible:ring-primary/40 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
          isIcon ? "h-9 w-9 rounded-full" : "h-10 px-4",
          VARIANT_CLASSES[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
