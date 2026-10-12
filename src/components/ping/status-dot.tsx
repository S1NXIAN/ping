import { cn } from "@/lib/utils";
import type { MonitorStatus } from "@/lib/monitor-status";

/** The four measured/configuration statuses plus the UI-only transient "checking". */
type DotStatus = MonitorStatus | "checking";

const colors: Record<DotStatus, string> = {
  up: "bg-up",
  down: "bg-down",
  paused: "bg-zinc-500",
  pending: "bg-zinc-400",
  checking: "bg-warn",
};

const ripples: Record<DotStatus, string | undefined> = {
  up: "ping-dot-ripple",
  down: "ping-dot-ripple",
  paused: undefined,
  pending: undefined,
  checking: "ping-dot-ripple",
};

export function StatusDot({
  status,
  className,
  pulse = true,
}: {
  status: DotStatus;
  className?: string;
  pulse?: boolean;
}) {
  const rippleColor =
    status === "up"
      ? "rgba(16,185,129,0.55)"
      : status === "down"
        ? "rgba(244,63,94,0.55)"
        : "rgba(245,158,11,0.55)";
  return (
    <span
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full",
        colors[status],
        pulse && ripples[status],
        className,
      )}
      style={{ ["--ripple-color" as string]: rippleColor }}
      aria-hidden="true"
    />
  );
}

/** Headline status label, title-case ("Live") — pills and card headlines. */
export function statusLabel(status: DotStatus): string {
  switch (status) {
    case "up":
      return "Live";
    case "down":
      return "Down";
    case "paused":
      return "Paused";
    case "checking":
      return "Checking…";
    default:
      return "Pending";
  }
}

/** Dense status word, lowercase ("live") — tooltips, tables, aria labels.
 *  The one source of truth for the status vocabulary: never inline a literal. */
export function statusWord(status: DotStatus): string {
  return statusLabel(status).toLowerCase();
}
