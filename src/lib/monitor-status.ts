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

/** The latency fields the degraded predicate reads. */
interface LatencyFields {
  lastStatus: string | null;
  lastResponseMs: number | null;
  slowThresholdMs: number | null;
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
 * True when the monitor's last check was UP but above its latency threshold —
 * an honest middle state between up and down, orthogonal to the ladder.
 */
export function isDegraded(m: LatencyFields): boolean {
  return (
    m.slowThresholdMs != null &&
    m.lastStatus === "up" &&
    m.lastResponseMs != null &&
    m.lastResponseMs > m.slowThresholdMs
  );
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
