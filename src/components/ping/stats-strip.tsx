"use client";

import { useState } from "react";
import { formatUptime, uptimeTone, uptimeToneClass } from "@/lib/ping-client";
import type { OverviewSummary } from "@/lib/ping-types";

/**
 * The dashboard's scope summary: uptime leads with a proportional band, with
 * the check and failure counts in a hairline column beside it. Every reading
 * comes from the scoped monitors the cards already describe — no second
 * aggregation, no invented series.
 *
 * The band carries the page's only ambient motion: a slow sweep that reads as
 * "watching", plus a one-shot faster pulse fired only when a real check has
 * landed since the previous poll.
 */
export function StatsStrip({ summary }: { summary?: OverviewSummary }) {
  // Adjusting state during render keeps the pulse out of an effect: the first
  // render seeds the timestamp, and only a strictly newer check fires it.
  const lastCheckAt = summary?.lastCheckAt ?? null;
  const [seenCheckAt, setSeenCheckAt] = useState(lastCheckAt);
  const [pulse, setPulse] = useState(0);
  if (lastCheckAt !== seenCheckAt) {
    setSeenCheckAt(lastCheckAt);
    if (lastCheckAt && seenCheckAt && lastCheckAt > seenCheckAt) {
      setPulse((n) => n + 1);
    }
  }

  const uptimeValue = formatUptime(summary?.avgUptime24h ?? null);
  const checksValue = summary ? summary.checks24h.toLocaleString() : "—";
  const failuresValue = summary ? summary.monitorsWithFailures24h : "—";
  const uptimeInk = uptimeToneClass(uptimeTone(summary?.avgUptime24h));
  const uptimePct =
    summary?.avgUptime24h != null
      ? Math.max(0, Math.min(1, summary.avgUptime24h)) * 100
      : 0;
  const noData = summary?.avgUptime24h == null;
  const blankBand = uptimePct === 0;
  const failuresInk = summary
    ? summary.monitorsWithFailures24h > 0
      ? "text-down"
      : "text-up"
    : "text-foreground";

  return (
    <div className="ping-stats">
      <div className="ping-stats-primary">
        <p className="ping-stats-label">Uptime 24h</p>
        <p key={uptimeValue} className={"ping-stats-value ping-value-in " + uptimeInk}>
          {uptimeValue}
        </p>
        <div
          className={
            "ping-stats-meter " +
            uptimeInk +
            (noData ? " is-empty" : "") +
            (blankBand ? " is-blank" : "")
          }
          aria-hidden="true"
        >
          <span className="ping-stats-fill" style={{ width: `${uptimePct}%` }}>
            {pulse > 0 && <span key={pulse} className="ping-stats-pulse" />}
          </span>
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
