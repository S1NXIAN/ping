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

  const checks = await db.check.findMany({
    where: { monitorId: { in: monitors.map((m) => m.id) }, checkedAt: { gte: since } },
    select: { monitorId: true, status: true, statusCode: true, checkedAt: true },
    orderBy: [{ monitorId: "asc" }, { checkedAt: "asc" }],
  });
  if (checks.length === 0) return [];

  const windowsByMonitor = new Map<string, { startsAt: number; endsAt: number }[]>();
  for (const w of historyWindows) {
    const list = windowsByMonitor.get(w.monitorId) ?? [];
    list.push({ startsAt: w.startsAt.getTime(), endsAt: w.endsAt.getTime() });
    windowsByMonitor.set(w.monitorId, list);
  }

  const byMonitor = new Map<string, typeof checks>();
  for (const c of checks) {
    const list = byMonitor.get(c.monitorId) ?? [];
    list.push(c);
    byMonitor.set(c.monitorId, list);
  }

  const incidents: DerivedIncident[] = [];
  for (const monitor of monitors) {
    const list = byMonitor.get(monitor.id);
    if (!list) continue;
    const gapMs = monitor.intervalSec * 3 * 1000;
    const monitorWindows = windowsByMonitor.get(monitor.id) ?? [];
    let open: { start: number; end: number; downChecks: number; lastCode: number | null } | null =
      null;
    let prevT: number | null = null;

    const close = (end: number | null) => {
      if (!open) return;
      const rel = windowRelation(monitorWindows, open.start, open.end);
      // Down streaks fully inside a planned window are maintenance, not
      // outages — skip them. Partial overlaps stay, flagged honestly.
      if (rel !== "inside") {
        incidents.push({
          monitorId: monitor.id,
          monitorName: monitor.name,
          startedAt: new Date(open.start).toISOString(),
          endedAt: end === null ? null : new Date(end).toISOString(),
          downChecks: open.downChecks,
          lastStatusCode: open.lastCode,
          duringMaintenance: rel === "overlaps",
        });
      }
    };

    for (const c of list) {
      const t = c.checkedAt.getTime();
      // A data gap longer than 3× the interval closes any open incident:
      // PING was asleep and we honestly don't know the service stayed down.
      if (prevT != null && t - prevT > gapMs && open) {
        close(t);
        open = null;
      }
      if (c.status === "down") {
        if (!open) open = { start: t, end: t, downChecks: 0, lastCode: null };
        open.downChecks += 1;
        open.end = t;
        open.lastCode = c.statusCode ?? open.lastCode;
      } else if (open) {
        close(t);
        open = null;
      }
      prevT = t;
    }
    if (open) {
      close(null);
    }
  }

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
