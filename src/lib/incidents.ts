// Incident derivation for the admin incidents view. Incidents are never
// stored as rows — they are stitched from REAL recorded checks: a run of
// consecutive "down" checks for one monitor, bounded by up checks (or still
// ongoing).
import { db } from "./db";
import { Prisma } from "@prisma/client";
import { MAX_MONITORS } from "./checker";
import type { IncidentDTO, IncidentState } from "./ping-types";

const INCIDENT_WINDOW_DAYS = 30;
/** How far back the "last down" stat reaches. The extra days are slack so a
 *  down recorded just before the window edge stays visible alongside any
 *  incident derived in INCIDENT_WINDOW_DAYS. */
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


/** One recorded down check. */
interface DownRow {
  t: number;
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
 * Lists the last 30 days of derived Incidents for one Scope (see GLOSSARY.md
 * "Scope"): the whole Fleet when `folderId` is omitted, else that Folder's
 * Monitors. Scoping happens before the cap, so a Folder's incidents are never
 * dropped for another's. Every incident comes from REAL checks.
 */
export async function listIncidents({
  folderId,
  now = Date.now(),
}: { folderId?: string; now?: number } = {}): Promise<IncidentDTO[]> {
  const monitors = await db.monitor.findMany({
    where: folderId ? { folderId } : undefined,
    select: { id: true, name: true, intervalSec: true, enabled: true },
  });
  return deriveIncidents(monitors, now);
}

/**
 * Stitches recorded checks into down incidents for the given monitors.
 * Derived from real data only — no incident is ever fabricated. Gaps longer
 * than 3× the monitor's interval are treated as "no data" and end an incident.
 * Failed checks taken while a monitor is paused stay in history but are
 * ignored here; an up check is still allowed to close the open incident.
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
async function deriveIncidents(
  monitors: {
    id: string;
    name: string;
    intervalSec: number;
    enabled: boolean;
  }[],
  /** Injectable clock for deterministic tests. */
  now = Date.now(),
): Promise<IncidentDTO[]> {
  if (monitors.length === 0) return [];
  const since = new Date(now - INCIDENT_WINDOW_DAYS * 86400_000);

  // 1) All down rows for the whole fleet in ONE query (newest
  //    MAX_DOWN_ROWS_PER_MONITOR per monitor; older rows can't reach the cut).
  //    A per-monitor query here was N queries per incidents view.
  const sinceMs = since.getTime();
  const rawDowns = await db.$queryRaw<
    Array<{ monitorId: string; checkedAt: Date | number | string }>
  >`
    SELECT monitorId, checkedAt FROM (
      SELECT monitorId, checkedAt,
             ROW_NUMBER() OVER (PARTITION BY monitorId ORDER BY checkedAt DESC) AS rn
      FROM "Check"
      WHERE monitorId IN (${Prisma.join(monitors.map((m) => m.id))})
        AND status = 'down' AND whilePaused = 0 AND checkedAt >= ${sinceMs}
    ) WHERE rn <= ${MAX_DOWN_ROWS_PER_MONITOR}`;
  const downsByMonitor = new Map<string, DownRow[]>();
  for (const r of rawDowns) {
    const list = downsByMonitor.get(r.monitorId) ?? [];
    list.push({ t: new Date(r.checkedAt as string | number).getTime() });
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
    // The gap that means "PING was asleep" scales to the monitor's interval.
    const gapMs = monitor.intervalSec * 3 * 1000;

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

  const monitorById = new Map(
    monitors.map((m) => [m.id, { name: m.name, paused: !m.enabled }]),
  );

  // 3) Every monitor's LAST streak is resolved first: it is the only streak
  //    that can be ongoing, and ongoing incidents are exempt from the cap.
  const incidents: IncidentDTO[] = await resolveStreaks(
    streaks.filter((s) => s.isLast),
    monitorById,
  );

  // 4) Resolve the remaining (closed-only) streaks newest-first, stopping as
  //    soon as the newest MAX_INCIDENTS closed incidents can no longer change:
  //    once the next streak's last down is older than the MAX_INCIDENTS-th
  //    newest closed incident, every unresolved streak starts no later and so
  //    cannot enter the cut.
  const rest = streaks.filter((s) => !s.isLast).sort((a, b) => b.lastDown - a.lastDown);
  for (let i = 0; i < rest.length; i += RESOLVE_BATCH) {
    incidents.push(...(await resolveStreaks(rest.slice(i, i + RESOLVE_BATCH), monitorById)));
    const settledStarts = incidents
      .filter((x) => x.state !== "ongoing")
      .map((x) => new Date(x.startedAt).getTime())
      .sort((a, b) => b - a);
    const nextLastDown = rest[i + RESOLVE_BATCH]?.lastDown;
    if (
      settledStarts.length >= MAX_INCIDENTS &&
      nextLastDown !== undefined &&
      nextLastDown < settledStarts[MAX_INCIDENTS - 1]
    ) {
      break;
    }
  }

  // Ongoing incidents pin to the top, newest-first among themselves, and are
  // exempt from the size cap; paused and closed incidents share the existing
  // newest-first history cap. The exempt set is bounded by the fleet cap (one
  // ongoing incident per monitor), so the list can never grow without limit
  // while still never dropping a real current outage.
  const byNewest = (a: IncidentDTO, b: IncidentDTO) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  const ongoing = incidents.filter((i) => i.state === "ongoing").sort(byNewest);
  const settled = incidents.filter((i) => i.state !== "ongoing").sort(byNewest);
  return [...ongoing.slice(0, MAX_ONGOING_INCIDENTS), ...settled.slice(0, MAX_INCIDENTS)];
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
  monitorById: Map<string, { name: string; paused: boolean }>,
): Promise<IncidentDTO[]> {
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
          AND NOT (c.status = 'down' AND c.whilePaused = 1)
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
  const out: IncidentDTO[] = [];
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

    const monitor = monitorById.get(streak.monitorId);
    const monitorPaused = monitor?.paused ?? false;
    for (const sub of subStreaks) {
      const subLast = sub.rows[sub.rows.length - 1].t;
      let endedAt: number | null = sub.closedByUpAt;
      let state: IncidentState = endedAt == null ? "ongoing" : "resolved";
      if (endedAt == null) {
        const boundary = boundaryByStreak.get(streak.id) ?? null;
        if (!boundary) {
          // No check after the run. A paused monitor cannot close it either.
          state = monitorPaused ? "paused" : "ongoing";
        } else if (boundary.status === "up") {
          endedAt = boundary.checkedAt;
          state = "resolved";
        } else {
          // A sleep gap ended the run; no recovery was observed.
          endedAt = subLast;
          state = "no-recovery";
        }
      }

      out.push({
        monitorId: streak.monitorId,
        monitorName: monitor?.name ?? "",
        startedAt: new Date(sub.rows[0].t).toISOString(),
        endedAt: endedAt == null ? null : new Date(endedAt).toISOString(),
        state,
      });
    }
  }
  return out;
}
