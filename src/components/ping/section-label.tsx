import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Uppercase tracked heading above a detail-sheet section. */
export function SectionLabel({
  icon: Icon,
  className,
  children,
}: {
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      className={cn(
        "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      {children}
    </h3>
  );
}
