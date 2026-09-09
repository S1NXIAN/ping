import { cn } from "@/lib/utils";

type DotStatus = "up" | "down" | "paused" | "pending" | "checking";

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

export function statusLabel(status: DotStatus): string {
  switch (status) {
    case "up":
      return "Up";
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
