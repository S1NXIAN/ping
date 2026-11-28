import { formatUptime, uptimeTone, uptimeToneClass } from "@/lib/ping-client";
import type { OverviewSummary } from "@/lib/ping-types";

/**
 * The dashboard's scope summary: uptime leads with a proportional band, with
 * the check and failure counts in a hairline column beside it. Every reading
 * comes from the scoped monitors the cards already describe — no second
 * aggregation, no invented series.
 */
export function StatsStrip({ summary }: { summary?: OverviewSummary }) {
  const uptimeValue = formatUptime(summary?.avgUptime24h ?? null);
  const checksValue = summary ? summary.checks24h.toLocaleString() : "—";
  const failuresValue = summary ? summary.monitorsWithFailures24h : "—";
  const uptimeInk = uptimeToneClass(uptimeTone(summary?.avgUptime24h));
  const uptimePct =
    summary?.avgUptime24h != null
      ? Math.max(0, Math.min(1, summary.avgUptime24h)) * 100
      : 0;
  const failuresInk = summary
    ? summary.monitorsWithFailures24h > 0
      ? "text-down"
      : "text-up"
    : "text-foreground";

  return (
    <div className="ping-stats">
      <div className="ping-stats-primary">
        <p className="ping-stats-label">Uptime 24h</p>
        <p className={"ping-stats-value " + uptimeInk}>{uptimeValue}</p>
        <div className={"ping-stats-meter " + uptimeInk} aria-hidden="true">
          <span style={{ width: `${uptimePct}%` }} />
        </div>
      </div>
      <div className="ping-stats-side">
        <div className="ping-stats-row">
          <span>Checks 24h</span>
          <b className="text-teal">{checksValue}</b>
        </div>
        <div className="ping-stats-row">
          <span>Failures 24h</span>
          <b className={failuresInk}>{failuresValue}</b>
        </div>
      </div>
    </div>
  );
}
