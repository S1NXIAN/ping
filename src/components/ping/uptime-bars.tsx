import { cn } from "@/lib/utils";

export interface BarSegment {
  /** 0..1 availability for the bucket; null = no data */
  ratio: number | null;
  /** native tooltip text */
  title: string;
}

/**
 * UptimeRobot-style bar strip. Renders one thin bar per segment —
 * emerald when fully up, rose when fully down, amber when partially up,
 * hatched gray when there is no data (never faked as up).
 */
export function UptimeBars({
  segments,
  className,
  barClassName = "h-7",
}: {
  segments: BarSegment[];
  className?: string;
  barClassName?: string;
}) {
  return (
    <div className={cn("flex items-stretch gap-[3px]", className)} role="img" aria-label="Check history bars">
      {segments.length === 0 && (
        <div className={cn("flex items-center text-[10px] text-muted-foreground", barClassName)}>
          no data yet
        </div>
      )}
      {segments.map((s, i) => {
        let cls: string;
        if (s.ratio == null) {
          cls = "bg-muted";
        } else if (s.ratio >= 1) {
          cls = "bg-up/90";
        } else if (s.ratio <= 0) {
          cls = "bg-down/90";
        } else {
          cls = "bg-warn/90";
        }
        return (
          <div
            key={i}
            title={s.title}
            className={cn(
              "min-w-[4px] flex-1 rounded-[2px] transition-colors hover:opacity-80",
              barClassName,
              cls,
              s.ratio == null && "opacity-40",
            )}
          />
        );
      })}
    </div>
  );
}

/** Converts recent checks (newest first) into card-level bar segments. */
export function checksToSegments(
  checks: { status: string; checkedAt: string; statusCode: number | null; responseMs: number | null }[],
): BarSegment[] {
  // reverse to chronological order for display left→right
  return [...checks]
    .reverse()
    .map((c) => ({
      ratio: c.status === "up" ? 1 : 0,
      title: `${new Date(c.checkedAt).toLocaleString()} — ${c.status === "up" ? "up" : "down"}${
        c.statusCode != null ? ` (HTTP ${c.statusCode})` : ""
      }${c.responseMs != null ? ` · ${c.responseMs} ms` : ""}`,
    }));
}

/** Converts daily buckets into detail-level segments with honest gaps. */
export function dailyToSegments(
  daily: { date: string; up: number; down: number }[],
  days = 30,
): BarSegment[] {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const segments: BarSegment[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const bucket = byDate.get(key);
    if (!bucket) {
      segments.push({ ratio: null, title: `${key} — no checks recorded` });
      continue;
    }
    const total = bucket.up + bucket.down;
    const ratio = total > 0 ? bucket.up / total : null;
    segments.push({
      ratio,
      title: `${key} — ${bucket.up} up / ${bucket.down} down${ratio != null ? ` (${Math.round(ratio * 100)}%)` : ""}`,
    });
  }
  return segments;
}
