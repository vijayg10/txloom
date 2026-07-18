import type { ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";
import { cn } from "@/lib/cn.js";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: ModalProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="data-[state=open]:animate-fade-scale-in fixed inset-0 z-50 bg-gray-900/40" />
        <RadixDialog.Content
          className={cn(
            "border-border bg-card fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[560px] min-w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-3xl border p-6 shadow-xl",
            "data-[state=open]:animate-fade-scale-in data-[state=closed]:animate-fade-scale-out",
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RadixDialog.Title className="text-text text-lg font-semibold">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="text-text-secondary mt-1 text-sm">
                  {description}
                </RadixDialog.Description>
              ) : (
                <VisuallyHidden asChild>
                  <RadixDialog.Description>{title}</RadixDialog.Description>
                </VisuallyHidden>
              )}
            </div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                className="text-text-secondary hover:bg-hover rounded-lg p-1.5"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </RadixDialog.Close>
          </div>
          <div className="text-text text-sm">{children}</div>
          {footer ? <div className="mt-6 flex items-center justify-end gap-3">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
