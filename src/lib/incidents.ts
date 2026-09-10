// Incident derivation shared by the public status page and the admin
// incidents view. Incidents are never stored as rows — they are stitched
// from REAL recorded checks: a run of consecutive "down" checks for one
// monitor, bounded by up checks (or still ongoing). Admin postmortem notes
// (IncidentNote rows) are joined on by the exact timestamp of the first
// failed check, which is the stable key both sides agree on.
import { db } from "./db";
import type { AdminIncidentDTO } from "./ping-types";

export const INCIDENT_WINDOW_DAYS = 30;
export const MAX_INCIDENTS = 15;
/** Hard caps so a pathological (flapping) monitor can never make this unbounded. */
const MAX_DOWN_ROWS_PER_MONITOR = 5000;
const MAX_STREAKS_PER_MONITOR = 40;
const MAX_UP_MARKERS_PER_STREAK = 2000;

export interface DerivedIncident {
  monitorId: string;
  monitorName: string;
  startedAt: string; // ISO — first failed check
  /** Null while the incident is still ongoing. */
  endedAt: string | null;
  downChecks: number;
  lastStatusCode: number | null;
  /** True when the down period overlaps a planned maintenance window. */
  duringMaintenance: boolean;
}

/**
 * Stitches recorded checks into down incidents for the given monitors.
 * Derived from real data only — no incident is ever fabricated. Gaps longer
 * than 3× the monitor's interval are treated as "no data" and end an
 * incident. Down streaks that fall entirely inside a planned maintenance
 * window are skipped (planned, not an outage); partial overlaps are kept
 * but flagged `duringMaintenance` so pages can present them honestly.
 *
 * Implementation note — memory safety: a naive derivation scans EVERY check
 * of the last 30 days (tens of thousands of rows per monitor under a short
 * interval). This version only bulk-loads "down" rows (the rare exception),
 * then resolves each detected streak with two tiny targeted queries: the up
 * checks recorded inside the streak's span (so a blip that recovered in
 * between stays two honest incidents rather than one merged) and, for the
 * final sub-streak, the first check recorded after its last down (the exact
 * closing time; null = still ongoing). The output is identical to the full
 * scan, but the work is bounded no matter how much history is kept.
 */
export async function deriveIncidents(
  monitors: { id: string; name: string; intervalSec: number }[],
): Promise<DerivedIncident[]> {
  if (monitors.length === 0) return [];
  const since = new Date(Date.now() - INCIDENT_WINDOW_DAYS * 86400_000);

  // All windows that overlap the incident lookback (incl. already-ended
  // ones) — used to classify down streaks, never shown directly.
  const historyWindows = await db.maintenanceWindow.findMany({
    where: {
      monitorId: { in: monitors.map((m) => m.id) },
      startsAt: { lte: new Date() },
      endsAt: { gte: since },
    },
    select: { monitorId: true, startsAt: true, endsAt: true },
  });
  const windowsByMonitor = new Map<string, { startsAt: number; endsAt: number }[]>();
  for (const w of historyWindows) {
    const list = windowsByMonitor.get(w.monitorId) ?? [];
    list.push({ startsAt: w.startsAt.getTime(), endsAt: w.endsAt.getTime() });
    windowsByMonitor.set(w.monitorId, list);
  }

  const incidents: DerivedIncident[] = [];

  await Promise.all(
    monitors.map(async (monitor) => {
      const gapMs = monitor.intervalSec * 3 * 1000;
      const monitorWindows = windowsByMonitor.get(monitor.id) ?? [];

      // 1) Down rows only (newest cap; older ones can't reach the global cut).
      const downRows = await db.check.findMany({
        where: { monitorId: monitor.id, status: "down", checkedAt: { gte: since } },
        select: { statusCode: true, checkedAt: true },
        orderBy: { checkedAt: "desc" },
        take: MAX_DOWN_ROWS_PER_MONITOR,
      });
      if (downRows.length === 0) return;
      const downs = downRows
        .map((c) => ({ t: c.checkedAt.getTime(), code: c.statusCode ?? null }))
        .reverse(); // chronological

      // 2) Group consecutive downs into streaks; a data gap > 3× interval
      //    ends a streak (PING was asleep — we can't claim it stayed down).
      const streaks: typeof downs[] = [];
      let open: typeof downs = [];
      let prevT: number | null = null;
      for (const d of downs) {
        if (open.length > 0 && prevT != null && d.t - prevT > gapMs) {
          streaks.push(open);
          open = [];
        }
        open.push(d);
        prevT = d.t;
      }
      if (open.length > 0) streaks.push(open);

      // Only the newest streaks per monitor can survive the global cut.
      for (const streak of streaks.slice(-MAX_STREAKS_PER_MONITOR)) {
        const start = streak[0].t;
        const lastDown = streak[streak.length - 1].t;

        // 3) Up checks recorded strictly inside the streak's span split it —
        //    a one-check blip that recovered must not merge with later downs.
        const upRows = await db.check.findMany({
          where: {
            monitorId: monitor.id,
            status: "up",
            checkedAt: { gt: new Date(start), lt: new Date(lastDown) },
          },
          select: { checkedAt: true },
          orderBy: { checkedAt: "desc" },
          take: MAX_UP_MARKERS_PER_STREAK,
        });
        const ups = upRows.map((u) => u.checkedAt.getTime()).reverse(); // chronological

        // Walk the streak's downs, closing a sub-streak at each up marker.
        const subStreaks: { rows: typeof downs; closedByUpAt: number | null }[] = [];
        let cur: typeof downs = [];
        let upIdx = 0;
        for (const d of streak) {
          while (upIdx < ups.length && ups[upIdx] < d.t) {
            if (cur.length > 0) subStreaks.push({ rows: cur, closedByUpAt: ups[upIdx] });
            cur = [];
            upIdx += 1;
          }
          cur.push(d);
        }
        if (cur.length > 0) subStreaks.push({ rows: cur, closedByUpAt: null });

        for (const sub of subStreaks) {
          const subStart = sub.rows[0].t;
          const subLast = sub.rows[sub.rows.length - 1].t;
          // Closing check: a splitting up (exact recovery time) or the first
          // check after the last down (up = recovered; far-future = gap).
          // No following check at all → the incident is still ongoing.
          let endedAt: number | null = sub.closedByUpAt;
          if (endedAt == null) {
            const boundary = await db.check.findFirst({
              where: { monitorId: monitor.id, checkedAt: { gt: new Date(subLast) } },
              select: { checkedAt: true },
              orderBy: { checkedAt: "asc" },
            });
            endedAt = boundary ? boundary.checkedAt.getTime() : null;
          }

          const rel = windowRelation(monitorWindows, subStart, subLast);
          // Down streaks fully inside a planned window are maintenance, not
          // outages — skip them. Partial overlaps stay, flagged honestly.
          if (rel === "inside") continue;
          incidents.push({
            monitorId: monitor.id,
            monitorName: monitor.name,
            startedAt: new Date(subStart).toISOString(),
            endedAt: endedAt == null ? null : new Date(endedAt).toISOString(),
            downChecks: sub.rows.length,
            lastStatusCode: sub.rows[sub.rows.length - 1].code,
            duringMaintenance: rel === "overlaps",
          });
        }
      }
    }),
  );

  incidents.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return incidents.slice(0, MAX_INCIDENTS);
}

/** Joins admin IncidentNote rows onto derived incidents (exact start match). */
export async function incidentsWithNotes(
  incidents: DerivedIncident[],
): Promise<AdminIncidentDTO[]> {
  if (incidents.length === 0) return [];
  const notes = await db.incidentNote.findMany({
    where: { monitorId: { in: incidents.map((i) => i.monitorId) } },
  });
  const byKey = new Map(
    notes.map((n) => [`${n.monitorId}:${n.startedAt.getTime()}`, n] as const),
  );
  return incidents.map((inc) => {
    const n = byKey.get(`${inc.monitorId}:${new Date(inc.startedAt).getTime()}`);
    return { ...inc, noteId: n?.id ?? null, note: n?.note ?? null };
  });
}

/** How the down streak [start, end] relates to the monitor's windows. */
function windowRelation(
  windows: { startsAt: number; endsAt: number }[],
  start: number,
  end: number,
): "inside" | "overlaps" | "none" {
  for (const w of windows) {
    if (w.startsAt <= start && end <= w.endsAt) return "inside";
    if (start < w.endsAt && w.startsAt < end) return "overlaps";
  }
  return "none";
}
