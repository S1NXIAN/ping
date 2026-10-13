// Incident derivation for the admin incidents view. Incidents are never
// stored as rows — they are stitched
// from REAL recorded checks: a run of consecutive "down" checks for one
// monitor, bounded by up checks (or still ongoing). Admin postmortem notes
// (IncidentNote rows) are joined on by the exact timestamp of the first
// failed check, which is the stable key both sides agree on.
import { db } from "./db";
import { Prisma } from "@prisma/client";
import { MAX_MONITORS } from "./checker";
import { nominalPeriodSec, parseTimes } from "./schedule";
import type { AdminIncidentDTO } from "./ping-types";

export const INCIDENT_WINDOW_DAYS = 30;
export const MAX_INCIDENTS = 15;
/** Ongoing incidents are exempt from MAX_INCIDENTS so a long outage is never
 *  dropped for newer ones. Each monitor yields at most one ongoing incident,
 *  so the exempt set is bounded by the fleet cap — never a small fixed number,
 *  which silently hid a real current outage (six monitors down, five listed). */
export const MAX_ONGOING_INCIDENTS = MAX_MONITORS;
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
}

/**
 * Stitches recorded checks into down incidents for the given monitors.
 * Derived from real data only — no incident is ever fabricated. Gaps longer
 * than 3× the monitor's interval are treated as "no data" and end an
 * incident.
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
  monitors: {
    id: string;
    name: string;
    intervalSec: number;
    scheduleMode?: string;
    scheduleTimes?: string | null;
  }[],
): Promise<DerivedIncident[]> {
  if (monitors.length === 0) return [];
  const since = new Date(Date.now() - INCIDENT_WINDOW_DAYS * 86400_000);

  const incidents: DerivedIncident[] = [];

  // 1) All down rows for the whole fleet in ONE query (newest
  //    MAX_DOWN_ROWS_PER_MONITOR per monitor; older rows can't reach the cut).
  //    A per-monitor query here was N queries per incidents view.
  const sinceMs = since.getTime();
  const rawDowns = await db.$queryRaw<
    Array<{ monitorId: string; statusCode: number | null; checkedAt: Date | number | string }>
  >`
    SELECT monitorId, statusCode, checkedAt FROM (
      SELECT monitorId, statusCode, checkedAt,
             ROW_NUMBER() OVER (PARTITION BY monitorId ORDER BY checkedAt DESC) AS rn
      FROM "Check"
      WHERE monitorId IN (${Prisma.join(monitors.map((m) => m.id))})
        AND status = 'down' AND checkedAt >= ${sinceMs}
    ) WHERE rn <= ${MAX_DOWN_ROWS_PER_MONITOR}`;
  const downsByMonitor = new Map<string, Array<{ t: number; code: number | null }>>();
  for (const r of rawDowns) {
    const list = downsByMonitor.get(r.monitorId) ?? [];
    list.push({ t: new Date(r.checkedAt as string | number).getTime(), code: r.statusCode ?? null });
    downsByMonitor.set(r.monitorId, list);
  }
  // ROW_NUMBER ordered newest-first; reverse each list to chronological.
  for (const list of downsByMonitor.values()) list.reverse();

  await Promise.all(
    monitors.map(async (monitor) => {
      // The gap that means "PING was asleep" scales to the monitor's real
      // cadence. A times-of-day monitor has no fixed interval, so its nominal
      // period is derived from its clock times (1:00 PM + 3:00 AM -> a real
      // 14h overnight gap). Using a stored interval here would split every
      // incident at that gap.
      const nominalSec =
        monitor.scheduleMode === "times"
          ? nominalPeriodSec(parseTimes(monitor.scheduleTimes))
          : monitor.intervalSec;
      const gapMs = nominalSec * 3 * 1000;

      const downs = downsByMonitor.get(monitor.id) ?? [];
      if (downs.length === 0) return;

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

          incidents.push({
            monitorId: monitor.id,
            monitorName: monitor.name,
            startedAt: new Date(subStart).toISOString(),
            endedAt: endedAt == null ? null : new Date(endedAt).toISOString(),
            downChecks: sub.rows.length,
            lastStatusCode: sub.rows[sub.rows.length - 1].code,
          });
        }
      }
    }),
  );

  // Ongoing incidents (no end) pin to the top, newest-first among themselves,
  // and are exempt from the closed-incident size cap; closed incidents keep
  // the existing newest-first order and cap. The exempt set is bounded by the
  // fleet cap (one ongoing incident per monitor), so the list can never grow
  // without limit while still never dropping a real current outage.
  const byNewest = (a: DerivedIncident, b: DerivedIncident) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  const ongoing = incidents.filter((i) => i.endedAt == null).sort(byNewest);
  const closed = incidents.filter((i) => i.endedAt != null).sort(byNewest);
  return [...ongoing.slice(0, MAX_ONGOING_INCIDENTS), ...closed.slice(0, MAX_INCIDENTS)];
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
