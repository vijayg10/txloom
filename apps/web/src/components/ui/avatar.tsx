import { cn } from "@/lib/cn.js";

interface AvatarProps extends React.ComponentPropsWithoutRef<"span"> {
  name: string;
}

export function Avatar({ name, className, ...rest }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <span
      className={cn(
        "bg-primary/10 text-primary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        className,
      )}
      {...rest}
    >
      {initials}
    </span>
  );
}
