import { cloneElement, isValidElement, useId, type ReactElement } from "react";
import { cn } from "@/lib/cn.js";

interface FormFieldProps {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactElement<{
    id?: string | undefined;
    "aria-describedby"?: string | undefined;
    "aria-invalid"?: boolean | undefined;
  }>;
}

export function FormField({ label, error, hint, className, children }: FormFieldProps) {
  const generatedId = useId();
  const childId = children.props.id ?? generatedId;
  const hintId = hint ? `${childId}-hint` : undefined;
  const errorId = error ? `${childId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: childId,
        "aria-describedby": describedBy,
        "aria-invalid": Boolean(error),
      })
    : children;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={childId} className="text-text-secondary text-xs font-medium">
        {label}
      </label>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-muted text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
