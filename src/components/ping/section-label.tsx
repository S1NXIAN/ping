import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZE = {
  /** dense sheet sections */
  sm: { text: "text-[11px] font-medium", icon: "size-3" },
  /** detail-sheet and settings sections */
  md: { text: "text-xs font-semibold", icon: "size-3.5" },
} as const;

const TONE = {
  muted: "text-muted-foreground",
  warn: "text-warn",
  strong: "text-foreground/90",
} as const;

/**
 * The 10–12px uppercase tracked heading above a group (see DESIGN.md
 * "Instrument Type Rule"). `tone` carries the section's state — warn for a
 * degraded group — never decoration.
 */
export function SectionLabel({
  icon: Icon,
  tone = "muted",
  size = "md",
  className,
  children,
}: {
  icon?: LucideIcon;
  tone?: keyof typeof TONE;
  size?: keyof typeof SIZE;
  className?: string;
  children: React.ReactNode;
}) {
  const s = SIZE[size];
  return (
    <h3
      className={cn("flex items-center gap-1.5 uppercase tracking-wide", s.text, TONE[tone], className)}
    >
      {Icon && <Icon className={cn(s.icon, "shrink-0")} aria-hidden="true" />}
      {children}
    </h3>
  );
}
