import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "up" | "down" | "warn" | "teal";
  className?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    up: "text-up",
    down: "text-down",
    warn: "text-warn",
    teal: "text-teal",
  }[tone];

  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3.5 py-3 transition-colors hover:border-primary/25 hover:bg-card/60",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/85">
        {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
        {label}
      </div>
      <div className={cn("mt-1.5 text-xl font-bold tabular-nums leading-tight tracking-tight", toneClass)}>
        {value}
      </div>
      {sub != null && (
        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/75">{sub}</div>
      )}
    </div>
  );
}
