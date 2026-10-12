// Monitor status — the one place that decides a monitor's status.
//
// Pure and framework-free, so both client components and server routes import
// it (see GLOSSARY.md "Monitor status"). Only `up` and `down` are measured
// health, read from the latest Check; `paused` is configuration (checks off)
// and `pending` is the absence of any check yet.

/** The four-value summary every surface shows for a monitor. */
export type MonitorStatus = "up" | "down" | "paused" | "pending";

/** The ladder's input — a MonitorDTO and a Prisma Monitor row both satisfy it. */
interface StatusFields {
  enabled: boolean;
  lastStatus: string | null;
}

/** A check as the slow predicate reads it — status plus its response time. */
interface SlowCheck {
  status: string;
  responseMs: number | null;
}

/** The latency fields the slow predicate reads: the threshold and the same
 *  recent-Checks window the card bars show. */
interface LatencyFields {
  lastStatus: string | null;
  slowThresholdMs: number | null;
  recentChecks: SlowCheck[];
}

/**
 * The status ladder: a disabled monitor is paused regardless of its last
 * check; an enabled one reports its measured status, or pending if it has
 * never been checked.
 */
export function monitorStatus(m: StatusFields): MonitorStatus {
  if (!m.enabled) return "paused";
  if (m.lastStatus === "up") return "up";
  if (m.lastStatus === "down") return "down";
  return "pending";
}

/**
 * The mean response time of the monitor's recent UP checks (the same window
 * the card bars show), or null when the window holds no timed up check.
 * One slow sample can no longer flip a healthy monitor; one fast sample can
 * no longer hide a slow one.
 */
export function averageUpResponseMs(checks: SlowCheck[]): number | null {
  let sum = 0;
  let n = 0;
  for (const c of checks) {
    if (c.status === "up" && c.responseMs != null) {
      sum += c.responseMs;
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

/**
 * True when the monitor's recent up checks average above its latency
 * threshold — an honest middle state between up and down, orthogonal to the
 * ladder. A down monitor is never slow (the ladder already says down), no up
 * checks in the window is never slow, and no threshold is never slow.
 */
export function isDegraded(m: LatencyFields): boolean {
  if (m.slowThresholdMs == null || m.lastStatus !== "up") return false;
  const avg = averageUpResponseMs(m.recentChecks);
  return avg != null && avg > m.slowThresholdMs;
}

/**
 * Counts a fleet by status. `degraded` is a sub-count of `up` (an up monitor
 * over its latency threshold), not a fifth status. `total` is deliberately not
 * returned — it is just the input length.
 */
export function fleetStatus(monitors: (StatusFields & LatencyFields)[]): {
  up: number;
  down: number;
  degraded: number;
  paused: number;
  pending: number;
} {
  const counts = { up: 0, down: 0, degraded: 0, paused: 0, pending: 0 };
  for (const m of monitors) {
    counts[monitorStatus(m)] += 1;
    // isDegraded already implies enabled + lastStatus "up".
    if (m.enabled && isDegraded(m)) counts.degraded += 1;
  }
  return counts;
}
