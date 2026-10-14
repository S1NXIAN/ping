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

const INCIDENT_WINDOW_DAYS = 30;
/** How far back the two lookups that must outlive the derivation window reach:
 *  the "last down" stat and the incident-note prune. The extra days are slack
 *  so a note or down recorded just before the window edge is not dropped while
 *  its incident can still be derived (which uses INCIDENT_WINDOW_DAYS). */
export const INCIDENT_LOOKBACK_DAYS = INCIDENT_WINDOW_DAYS + 2;
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
/** Streaks resolved per round while the closed-incident cut is still open. */
const RESOLVE_BATCH = 256;

export interface DerivedIncident {
  monitorId: string;
  monitorName: string;
  startedAt: string; // ISO — first failed check
  /** Null while the incident is still ongoing. */
  endedAt: string | null;
  downChecks: number;
  lastStatusCode: number | null;
}

/** One recorded down check. */
interface DownRow {
  t: number;
  code: number | null;
}

/** A run of consecutive down checks for one monitor, before splitting on the
 *  up checks recorded inside it. */
interface Streak {
  /** Stable index, used to key the batched queries back to the streak. */
  id: number;
  monitorId: string;
  rows: DownRow[];
  /** Newest streak for its monitor — the only one that can still be ongoing. */
  isLast: boolean;
  /** Last down time; no incident from this streak can start after it. */
  lastDown: number;
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
 * then resolves the streaks they form with fleet-wide batched queries: one for
 * the up checks recorded inside every streak's span (so a blip that recovered
 * in between stays two honest incidents rather than one merged), and one for
 * the first check after each streak's last down (the exact closing time; null
 * = still ongoing). It also resolves only the streaks that can reach the
 * output — every monitor's last streak (the only one that can be ongoing) plus
 * the newest streaks until the newest MAX_INCIDENTS closed incidents can no
 * longer change. The output is identical to the full scan, but the work is
 * bounded by the output size, not by the fleet's total streak count.
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
  const downsByMonitor = new Map<string, DownRow[]>();
  for (const r of rawDowns) {
    const list = downsByMonitor.get(r.monitorId) ?? [];
    list.push({ t: new Date(r.checkedAt as string | number).getTime(), code: r.statusCode ?? null });
    downsByMonitor.set(r.monitorId, list);
  }
  // ROW_NUMBER ordered newest-first; reverse each list to chronological.
  for (const list of downsByMonitor.values()) list.reverse();

  // 2) Group each monitor's downs into streaks; a data gap > 3× its cadence
  //    ends a streak (PING was asleep — we can't claim it stayed down). Only
  //    the newest MAX_STREAKS_PER_MONITOR streaks can survive the global cut.
  const streaks: Streak[] = [];
  let nextId = 0;
  for (const monitor of monitors) {
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
    if (downs.length === 0) continue;

    const ownStreaks: DownRow[][] = [];
    let open: DownRow[] = [];
    let prevT: number | null = null;
    for (const d of downs) {
      if (open.length > 0 && prevT != null && d.t - prevT > gapMs) {
        ownStreaks.push(open);
        open = [];
      }
      open.push(d);
      prevT = d.t;
    }
    if (open.length > 0) ownStreaks.push(open);

    const kept = ownStreaks.slice(-MAX_STREAKS_PER_MONITOR);
    kept.forEach((rows, i) => {
      streaks.push({
        id: nextId++,
        monitorId: monitor.id,
        rows,
        isLast: i === kept.length - 1,
        lastDown: rows[rows.length - 1].t,
      });
    });
  }
  if (streaks.length === 0) return [];

  const nameById = new Map(monitors.map((m) => [m.id, m.name]));

  // 3) Every monitor's LAST streak is resolved first: it is the only streak
  //    that can be ongoing, and ongoing incidents are exempt from the cap.
  const incidents: DerivedIncident[] = await resolveStreaks(
    streaks.filter((s) => s.isLast),
    nameById,
  );

  // 4) Resolve the remaining (closed-only) streaks newest-first, stopping as
  //    soon as the newest MAX_INCIDENTS closed incidents can no longer change:
  //    once the next streak's last down is older than the MAX_INCIDENTS-th
  //    newest closed incident, every unresolved streak starts no later and so
  //    cannot enter the cut.
  const rest = streaks.filter((s) => !s.isLast).sort((a, b) => b.lastDown - a.lastDown);
  for (let i = 0; i < rest.length; i += RESOLVE_BATCH) {
    incidents.push(...(await resolveStreaks(rest.slice(i, i + RESOLVE_BATCH), nameById)));
    const closedStarts = incidents
      .filter((x) => x.endedAt != null)
      .map((x) => new Date(x.startedAt).getTime())
      .sort((a, b) => b - a);
    const nextLastDown = rest[i + RESOLVE_BATCH]?.lastDown;
    if (
      closedStarts.length >= MAX_INCIDENTS &&
      nextLastDown !== undefined &&
      nextLastDown < closedStarts[MAX_INCIDENTS - 1]
    ) {
      break;
    }
  }

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

/**
 * Resolves a batch of streaks into incidents with two fleet-wide queries: the
 * up checks recorded inside every streak's span (which split it into honest
 * sub-streaks) and, per streak, the first check recorded after its last down
 * (the exact closing time; null = still ongoing).
 *
 * A non-last streak still needs its closing check: a recovery observed before
 * the sleep gap closes the incident at that up check, not at the streak's own
 * last down.
 */
async function resolveStreaks(
  streaks: Streak[],
  nameById: Map<string, string>,
): Promise<DerivedIncident[]> {
  if (streaks.length === 0) return [];

  // Up checks strictly inside each streak's span. ONE query over all spans (a
  // join against a VALUES table), keeping per streak only the newest
  // MAX_UP_MARKERS_PER_STREAK markers (the pathological-input cap).
  const upRows = await db.$queryRaw<Array<{ id: number | bigint; checkedAt: Date | number | string }>>`
    WITH spans(id, monitorId, lo, hi) AS (VALUES ${Prisma.join(
      streaks.map((s) => Prisma.sql`(${s.id}, ${s.monitorId}, ${s.rows[0].t}, ${s.lastDown})`),
    )}),
    ranked AS (
      SELECT s.id AS id, c.checkedAt AS checkedAt,
             ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY c.checkedAt DESC) AS rn
      FROM spans s
      JOIN "Check" c
        ON c.monitorId = s.monitorId AND c.checkedAt > s.lo AND c.checkedAt < s.hi
      WHERE c.status = 'up'
    )
    SELECT id, checkedAt FROM ranked WHERE rn <= ${MAX_UP_MARKERS_PER_STREAK}
    ORDER BY id ASC, checkedAt ASC`;
  const upsByStreak = new Map<number, number[]>();
  for (const r of upRows) {
    const id = Number(r.id);
    const list = upsByStreak.get(id) ?? [];
    list.push(new Date(r.checkedAt as string | number).getTime());
    upsByStreak.set(id, list);
  }

  // The first check after each streak's last down. ONE query for the batch.
  const boundaryRows = await db.$queryRaw<
    Array<{ id: number | bigint; status: string | null; checkedAt: Date | number | string | null }>
  >`
    WITH lasts(id, monitorId, lastDown) AS (VALUES ${Prisma.join(
      streaks.map((s) => Prisma.sql`(${s.id}, ${s.monitorId}, ${s.lastDown})`),
    )})
    SELECT l.id AS id, b.status AS status, b.checkedAt AS checkedAt
    FROM lasts l
    LEFT JOIN "Check" b
      ON b.monitorId = l.monitorId
      AND b.checkedAt = (
        SELECT c.checkedAt FROM "Check" c
        WHERE c.monitorId = l.monitorId AND c.checkedAt > l.lastDown
        ORDER BY c.checkedAt ASC LIMIT 1
      )`;
  const boundaryByStreak = new Map<number, { status: string; checkedAt: number } | null>();
  for (const r of boundaryRows) {
    boundaryByStreak.set(
      Number(r.id),
      r.status == null || r.checkedAt == null
        ? null
        : { status: r.status, checkedAt: new Date(r.checkedAt as string | number).getTime() },
    );
  }

  // Walk each streak's downs, closing a sub-streak at each up marker. The
  // final sub-streak closes at its boundary (the first check after its last
  // down); earlier sub-streaks were split by an up, which already set their
  // end. An UP closes the incident at that observed recovery time. A following
  // DOWN must NOT close it — that would fabricate an outage duration across the
  // sleep gap we never observed; the incident ends at its own last down
  // instead. No following check at all → still ongoing.
  const out: DerivedIncident[] = [];
  for (const streak of streaks) {
    const ups = upsByStreak.get(streak.id) ?? [];
    const subStreaks: Array<{ rows: DownRow[]; closedByUpAt: number | null }> = [];
    let cur: DownRow[] = [];
    let upIdx = 0;
    for (const d of streak.rows) {
      while (upIdx < ups.length && ups[upIdx] < d.t) {
        if (cur.length > 0) subStreaks.push({ rows: cur, closedByUpAt: ups[upIdx] });
        cur = [];
        upIdx += 1;
      }
      cur.push(d);
    }
    if (cur.length > 0) subStreaks.push({ rows: cur, closedByUpAt: null });

    for (const sub of subStreaks) {
      const subLast = sub.rows[sub.rows.length - 1].t;
      let endedAt: number | null = sub.closedByUpAt;
      if (endedAt == null) {
        const boundary = boundaryByStreak.get(streak.id) ?? null;
        if (!boundary) endedAt = null;
        else endedAt = boundary.status === "up" ? boundary.checkedAt : subLast;
      }

      out.push({
        monitorId: streak.monitorId,
        monitorName: nameById.get(streak.monitorId) ?? "",
        startedAt: new Date(sub.rows[0].t).toISOString(),
        endedAt: endedAt == null ? null : new Date(endedAt).toISOString(),
        downChecks: sub.rows.length,
        lastStatusCode: sub.rows[sub.rows.length - 1].code,
      });
    }
  }
  return out;
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
