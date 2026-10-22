import { Gauge, ListChecks, XCircle } from "lucide-react";
import { formatUptime, uptimeTone } from "@/lib/ping-client";
import type { MonitorDTO, OverviewSummary } from "@/lib/ping-types";
import { StatCard } from "./stat-card";
import { StatTrace } from "./stat-trace";

/**
 * The dashboard's scope summary as one instrument: three metric cells over a
 * single live response trace. Every reading comes from the scoped monitors
 * the cards already describe — no second aggregation, no invented series.
 */
export function StatsStrip({
  summary,
  monitors,
}: {
  summary?: OverviewSummary;
  monitors: MonitorDTO[];
}) {
  return (
    <div className="relative isolate mb-6 overflow-hidden border bg-card shadow-[inset_0_1px_0_0_rgba(255,255,255,0.045)]">
      <div className="relative z-10 grid grid-cols-3 divide-x divide-border">
        <StatCard
          label="Uptime 24h"
          value={formatUptime(summary?.avgUptime24h ?? null)}
          icon={Gauge}
          // Shared band ink (uptimeTone): displays-as-100% -> emerald,
          // 90–99.99% amber, <90% rose. Before, a perfect fleet shared
          // the neutral ink of "no data" — the up state was invisible.
          tone={uptimeTone(summary?.avgUptime24h) ?? "default"}
        />
        <StatCard
          label="Checks 24h"
          value={summary ? summary.checks24h.toLocaleString() : "—"}
          icon={ListChecks}
          tone="teal"
        />
        <StatCard
          label="Failures 24h"
          value={summary ? summary.monitorsWithFailures24h : "—"}
          icon={XCircle}
          tone={
            summary
              ? summary.monitorsWithFailures24h > 0
                ? "down"
                : "up"
              : "default"
          }
        />
      </div>
      <StatTrace monitors={monitors} />
    </div>
  );
}
