import { cn } from "@/lib/cn.js";

export function Table({ className, ...rest }: React.ComponentPropsWithoutRef<"table">) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className={cn("w-full border-collapse text-left text-sm text-text", className)} {...rest} />
    </div>
  );
}

export function TableHead({ className, ...rest }: React.ComponentPropsWithoutRef<"thead">) {
  return <thead className={cn("sticky top-0 z-10 bg-card", className)} {...rest} />;
}

export function TableHeaderRow({ className, ...rest }: React.ComponentPropsWithoutRef<"tr">) {
  return <tr className={cn("border-b border-border", className)} {...rest} />;
}

export function TableHeaderCell({ className, ...rest }: React.ComponentPropsWithoutRef<"th">) {
  return (
    <th
      scope="col"
      className={cn("px-4 py-3 text-xs font-semibold text-text-secondary", className)}
      {...rest}
    />
  );
}

export function TableBody({ className, ...rest }: React.ComponentPropsWithoutRef<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...rest} />;
}

export function TableRow({ className, ...rest }: React.ComponentPropsWithoutRef<"tr">) {
  return <tr className={cn("h-14 transition-colors duration-200 hover:bg-hover", className)} {...rest} />;
}

export function TableCell({ className, ...rest }: React.ComponentPropsWithoutRef<"td">) {
  return <td className={cn("px-4 py-3 tabular-nums", className)} {...rest} />;
}
