// The dashboard's four stat cards and header pills, computed from one Scope:
// the whole Fleet on "All monitors", or a single Folder otherwise (see
// GLOSSARY.md "Scope"). Every number is a pure sum/mean over the monitors the
// client already holds — the overview route no longer computes it, so the
// "all" and folder views can never disagree. Real data only: a monitor with no
// 24h uptime is excluded from the mean, never counted as zero.
import { fleetStatus } from "./monitor-status";
import type { MonitorDTO, OverviewSummary } from "./ping-types";

/** Summarizes a Scope into the OverviewSummary the stat strip and header read. */
export function summarize(monitors: MonitorDTO[]): OverviewSummary {
  const { up, down, degraded, paused, pending } = fleetStatus(monitors);

  const uptimes = monitors
    .map((m) => m.stats.uptime24h)
    .filter((u): u is number => u != null);
  const avgUptime24h = uptimes.length
    ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length
    : null;

  const checks24h = monitors.reduce((acc, m) => acc + m.stats.checks24h, 0);
  // Null means "no checks recorded yet", not "no failures" — and 0 (every
  // check failed) is exactly the value a truthy check would swallow.
  const monitorsWithFailures24h = monitors.filter(
    (m) => m.stats.uptime24h != null && m.stats.uptime24h < 1,
  ).length;

  const lastCheckAts = monitors
    .map((m) => m.lastCheckAt)
    .filter((t): t is string => !!t)
    .map((t) => new Date(t).getTime());
  const lastCheckAt = lastCheckAts.length
    ? new Date(Math.max(...lastCheckAts)).toISOString()
    : null;

  return {
    monitors: monitors.length,
    up,
    down,
    degraded,
    paused,
    pending,
    avgUptime24h,
    checks24h,
    monitorsWithFailures24h,
    lastCheckAt,
  };
}
