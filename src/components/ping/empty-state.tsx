import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The empty state for a sheet's list: a dashed outline box (honest emptiness,
 * the same language the uptime bars use), a title and one line of guidance.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center",
        className,
      )}
    >
      <div className="grid size-12 place-items-center rounded-none border border-dashed border-border">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
