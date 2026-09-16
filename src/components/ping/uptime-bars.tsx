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
 * dashed-outline gray when there is no data (never faked as up).
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
  // Spoken summary carries the real counts — never a vague "chart" label.
  const up = segments.filter((s) => s.ratio != null && s.ratio >= 1).length;
  const down = segments.filter((s) => s.ratio != null && s.ratio <= 0).length;
  const partial = segments.filter((s) => s.ratio != null && s.ratio > 0 && s.ratio < 1).length;
  const noData = segments.filter((s) => s.ratio == null).length;
  const ariaLabel =
    segments.length === 0
      ? "Check history: no checks recorded yet"
      : `Check history: ${up} up, ${down} down` +
        (partial ? `, ${partial} partial` : "") +
        (noData ? `, ${noData} with no data` : "");

  return (
    <div className={cn("flex items-stretch gap-[3px]", className)} role="img" aria-label={ariaLabel}>
      {segments.length === 0 && (
        <div className={cn("flex items-center text-[10px] text-muted-foreground", barClassName)}>
          no data yet
        </div>
      )}
      {segments.map((s, i) => {
        let cls: string;
        if (s.ratio == null) {
          // No data = dashed outline (the same language the public status
          // DayBars use): honest emptiness that still clears 3:1 non-text
          // contrast — bg-muted + opacity-40 measured 1.02:1, i.e. invisible.
          cls = "border border-dashed border-muted-foreground/60 bg-transparent";
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
              "min-w-[4px] flex-1 rounded-none transition-colors hover:opacity-80",
              barClassName,
              cls,
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
  // Day keys are UTC calendar days — the same convention the server buckets
  // by (date(checkedAt, 'unixepoch')). Matching it keeps every bar aligned
  // with its real data for viewers in any timezone (no shifted "today").
  const utcDayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const nowMs = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const key = utcDayKey(nowMs - i * 86400_000);
    const bucket = byDate.get(key);
    if (!bucket) {
      segments.push({ ratio: null, title: `${key} (UTC) — no checks recorded` });
      continue;
    }
    const total = bucket.up + bucket.down;
    const ratio = total > 0 ? bucket.up / total : null;
    segments.push({
      ratio,
      title: `${key} (UTC) — ${bucket.up} up / ${bucket.down} down${ratio != null ? ` (${Math.round(ratio * 100)}%)` : ""}`,
    });
  }
  return segments;
}
