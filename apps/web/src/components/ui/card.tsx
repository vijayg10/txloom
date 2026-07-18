import { cn } from "@/lib/cn.js";

export function Card({ className, ...rest }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("border-border bg-card rounded-2xl border p-6 shadow-sm", className)}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("mb-4 flex items-center justify-between gap-3", className)} {...rest} />
  );
}

export function CardTitle({ className, ...rest }: React.ComponentPropsWithoutRef<"h3">) {
  return <h3 className={cn("text-text text-[22px] font-semibold", className)} {...rest} />;
}

export function CardBody({ className, ...rest }: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("text-text text-sm", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("mt-4 flex items-center justify-end gap-3", className)} {...rest} />;
}
