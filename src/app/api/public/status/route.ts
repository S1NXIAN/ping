import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { collectMonitorStats, dailyBuckets } from "@/lib/ping-stats";
import type { PublicIncident, PublicStatusMonitor, PublicStatusResponse } from "@/lib/ping-types";

const INCIDENT_WINDOW_DAYS = 30;
const MAX_INCIDENTS = 15;

/**
 * Public, read-only status page data — NO session required. Gated by an
 * unguessable token in the query string. Exposes only monitor names,
 * statuses, uptime aggregates and daily up/down buckets — never URLs,
 * accounts, folders or raw history rows. Monitors flagged statusHidden are
 * excluded entirely.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const settings = await db.settings.findUnique({ where: { id: "main" } });

  const valid =
    !!settings?.statusToken &&
    token.length === settings.statusToken.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(settings.statusToken));

  if (!valid) {
    // Same answer for "disabled" and "wrong token" — reveals nothing.
    return NextResponse.json({ error: "Status page not found" }, { status: 404 });
  }

  const monitors = await db.monitor.findMany({
    where: { statusHidden: false },
    orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  const bundle = await collectMonitorStats();
  const dailies = await Promise.all(monitors.map((m) => dailyBuckets(m.id)));

  const rows: PublicStatusMonitor[] = monitors.map((m, i) => {
    const stats = bundle.statsByMonitor.get(m.id);
    return {
      id: m.id,
      name: m.name,
      status: !m.enabled
        ? "paused"
        : m.lastStatus === "up"
          ? "up"
          : m.lastStatus === "down"
            ? "down"
            : "pending",
      uptime24h: stats?.uptime24h ?? null,
      uptime7d: stats?.uptime7d ?? null,
      uptime30d: stats?.uptime30d ?? null,
      avgMs24h: stats?.avgMs24h ?? null,
      lastCheckAt: m.lastCheckAt?.toISOString() ?? null,
      lastStatusCode: m.lastStatusCode ?? null,
      lastDownAt: stats?.lastDownAt ?? null,
      daily: dailies[i] ?? [],
    };
  });

  const lastCheckAts = rows
    .map((r) => r.lastCheckAt)
    .filter((t): t is string => !!t)
    .map((t) => new Date(t).getTime());

  const incidents = await deriveIncidents(monitors);

  const body: PublicStatusResponse = {
    monitors: rows,
    summary: {
      total: rows.length,
      up: rows.filter((r) => r.status === "up").length,
      down: rows.filter((r) => r.status === "down").length,
      paused: rows.filter((r) => r.status === "paused").length,
      pending: rows.filter((r) => r.status === "pending").length,
      lastCheckAt: lastCheckAts.length ? new Date(Math.max(...lastCheckAts)).toISOString() : null,
    },
    title: settings?.statusTitle ?? null,
    incidents,
    serverTime: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Stitches recorded checks into down incidents: a run of consecutive "down"
 * checks for one monitor, bounded by up checks (or still ongoing). Derived
 * from real data only — no incident is ever fabricated. Gaps longer than
 * 3× the monitor's interval are treated as "no data" and end an incident.
 */
async function deriveIncidents(
  monitors: { id: string; name: string; intervalSec: number }[],
): Promise<PublicIncident[]> {
  if (monitors.length === 0) return [];
  const since = new Date(Date.now() - INCIDENT_WINDOW_DAYS * 86400_000);

  const checks = await db.check.findMany({
    where: { monitorId: { in: monitors.map((m) => m.id) }, checkedAt: { gte: since } },
    select: { monitorId: true, status: true, statusCode: true, checkedAt: true },
    orderBy: [{ monitorId: "asc" }, { checkedAt: "asc" }],
  });
  if (checks.length === 0) return [];

  const byMonitor = new Map<string, typeof checks>();
  for (const c of checks) {
    const list = byMonitor.get(c.monitorId) ?? [];
    list.push(c);
    byMonitor.set(c.monitorId, list);
  }

  const incidents: PublicIncident[] = [];
  for (const monitor of monitors) {
    const list = byMonitor.get(monitor.id);
    if (!list) continue;
    const gapMs = monitor.intervalSec * 3 * 1000;
    let open: { start: number; end: number; downChecks: number; lastCode: number | null } | null =
      null;
    let prevT: number | null = null;

    for (const c of list) {
      const t = c.checkedAt.getTime();
      // A data gap longer than 3× the interval closes any open incident:
      // PING was asleep and we honestly don't know the service stayed down.
      if (prevT != null && t - prevT > gapMs && open) {
        incidents.push({
          monitorId: monitor.id,
          monitorName: monitor.name,
          startedAt: new Date(open.start).toISOString(),
          endedAt: new Date(open.end).toISOString(),
          downChecks: open.downChecks,
          lastStatusCode: open.lastCode,
        });
        open = null;
      }
      if (c.status === "down") {
        if (!open) open = { start: t, end: t, downChecks: 0, lastCode: null };
        open.downChecks += 1;
        open.end = t;
        open.lastCode = c.statusCode ?? open.lastCode;
      } else if (open) {
        incidents.push({
          monitorId: monitor.id,
          monitorName: monitor.name,
          startedAt: new Date(open.start).toISOString(),
          endedAt: new Date(t).toISOString(),
          downChecks: open.downChecks,
          lastStatusCode: open.lastCode,
        });
        open = null;
      }
      prevT = t;
    }
    if (open) {
      incidents.push({
        monitorId: monitor.id,
        monitorName: monitor.name,
        startedAt: new Date(open.start).toISOString(),
        endedAt: null, // still down as of the last recorded check
        downChecks: open.downChecks,
        lastStatusCode: open.lastCode,
      });
    }
  }

  incidents.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return incidents.slice(0, MAX_INCIDENTS);
}
