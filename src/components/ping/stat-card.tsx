import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One cell of the dashboard stat strip. The strip owns the panel chrome and
 * the live trace; the cell contributes only its label, value, and tone.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
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
  const valueKey =
    typeof value === "string" || typeof value === "number" ? String(value) : "value";

  return (
    <div className={cn("relative min-w-0 px-2.5 pb-7 pt-3 sm:px-4 sm:pb-8 sm:pt-3.5", className)}>
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground/85 sm:gap-1.5 sm:tracking-widest">
        {Icon && <Icon className="hidden size-3.5 shrink-0 sm:block" aria-hidden="true" />}
        <span className="whitespace-nowrap">{label}</span>
      </div>
      <div
        key={valueKey}
        className={cn(
          "ping-value-in mt-1.5 text-xl font-bold tabular-nums leading-tight tracking-tight sm:mt-2",
          toneClass,
        )}
      >
        {value}
      </div>
    </div>
  );
}
