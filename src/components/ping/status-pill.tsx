import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The status pill — the recurring chip in the system (see DESIGN.md
 * "Pills"): a 10px/500 label on a colored alpha wash with a hairline
 * border, sharp corners. One source of truth for tone, so the alpha
 * drift that had crept across 14 hand-rolled call sites is gone.
 *
 * Tone vocabulary is measurement semantics, not decoration:
 *   up      Beacon Emerald — healthy
 *   down    Alarm Rose — failed
 *   warn    Caution Amber — slow
 *   accent  Signal White — pinned, keyword, account
 *   teal    Chalk — the soft-white working ink
 *   neutral Hairline/border — folders, paused, plain metadata
 */
export type PillTone = "up" | "down" | "warn" | "accent" | "teal" | "neutral";

/** Tone -> canonical wash + border + ink. The one place these alphas live. */
const TONE_CLASS: Record<PillTone, string> = {
  up: "border-up/30 bg-up/10 text-up",
  down: "border-down/30 bg-down/10 text-down",
  warn: "border-warn/35 bg-warn/10 text-warn",
  accent: "border-primary/30 bg-primary/10 text-primary",
  teal: "border-teal/30 bg-teal/10 text-teal",
  neutral: "border-border bg-muted text-muted-foreground",
};

const SIZE_CLASS = {
  /** dense: public status, sheets, incident lists */
  sm: "gap-1 px-1.5 py-px text-[10px]",
  /** card default */
  md: "gap-1 px-2 py-0.5 text-[10px]",
  /** header counters */
  lg: "h-6 gap-1 px-2.5 text-xs",
} as const;

export function StatusPill({
  tone,
  size = "md",
  uppercase = false,
  icon: Icon,
  className,
  children,
  ...props
}: {
  tone: PillTone;
  size?: keyof typeof SIZE_CLASS;
  uppercase?: boolean;
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
} & React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-none border font-medium",
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        uppercase && "uppercase tracking-wide",
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="size-2.5 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}
