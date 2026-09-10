import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { collectMonitorStats, dailyBuckets, isDegraded } from "@/lib/ping-stats";
import { deriveIncidents } from "@/lib/incidents";
import type {
  PublicIncident,
  PublicMaintenance,
  PublicStatusMonitor,
  PublicStatusResponse,
} from "@/lib/ping-types";

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
  const [dailies, windows] = await Promise.all([
    Promise.all(monitors.map((m) => dailyBuckets(m.id))),
    // Active + upcoming maintenance windows for the visible monitors.
    db.maintenanceWindow.findMany({
      where: { monitorId: { in: monitors.map((m) => m.id) }, endsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 20,
    }),
  ]);

  const now = Date.now();
  const activeMaintenance = new Set(
    windows.filter((w) => w.startsAt.getTime() <= now).map((w) => w.monitorId),
  );

  const rows: PublicStatusMonitor[] = monitors.map((m, i) => {
    const stats = bundle.statsByMonitor.get(m.id);
    const up = m.lastStatus === "up";
    // Response-time sparkline series: newest ≤20 checks (48h window) that
    // collectMonitorStats already fetched — chronological order, null for
    // failed checks so the sparkline shows gaps, never fake zeroes.
    // sparkT carries each point's timestamp (the sparkline's time axis).
    const sparkRows = (bundle.recentByMonitor.get(m.id) ?? []).slice().reverse();
    const spark = sparkRows.map((c) => (c.status === "up" ? c.responseMs : null));
    // CheckDTO.checkedAt is an ISO string — parse it to epoch ms.
    const sparkT = sparkRows.map((c) => new Date(c.checkedAt).getTime());
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
      degraded: m.enabled && up ? isDegraded(m) || null : null,
      uptime24h: stats?.uptime24h ?? null,
      uptime7d: stats?.uptime7d ?? null,
      uptime30d: stats?.uptime30d ?? null,
      avgMs24h: stats?.avgMs24h ?? null,
      lastCheckAt: m.lastCheckAt?.toISOString() ?? null,
      lastStatusCode: m.lastStatusCode ?? null,
      lastDownAt: stats?.lastDownAt ?? null,
      daily: dailies[i] ?? [],
      maintenance: activeMaintenance.has(m.id) || null,
      spark,
      sparkT,
    };
  });

  const lastCheckAts = rows
    .map((r) => r.lastCheckAt)
    .filter((t): t is string => !!t)
    .map((t) => new Date(t).getTime());

  const derived = await deriveIncidents(monitors);
  // Join admin postmortem notes onto the public incidents (text only).
  const noteRows = await db.incidentNote.findMany({
    where: { monitorId: { in: monitors.map((m) => m.id) } },
    select: { monitorId: true, startedAt: true, note: true },
  });
  const noteByKey = new Map(
    noteRows.map((n) => [`${n.monitorId}:${n.startedAt.getTime()}`, n.note] as const),
  );
  const incidents: PublicIncident[] = derived.map((inc) => ({
    ...inc,
    note: noteByKey.get(`${inc.monitorId}:${new Date(inc.startedAt).getTime()}`) ?? null,
  }));

  const maintenanceList: PublicMaintenance[] = windows.map((w) => ({
    monitorId: w.monitorId,
    monitorName: monitors.find((m) => m.id === w.monitorId)?.name ?? "?",
    startsAt: w.startsAt.toISOString(),
    endsAt: w.endsAt.toISOString(),
    note: w.note ?? null,
  }));

  const body: PublicStatusResponse = {
    monitors: rows,
    summary: {
      total: rows.length,
      up: rows.filter((r) => r.status === "up").length,
      down: rows.filter((r) => r.status === "down").length,
      degraded: rows.filter((r) => r.degraded === true).length,
      paused: rows.filter((r) => r.status === "paused").length,
      pending: rows.filter((r) => r.status === "pending").length,
      lastCheckAt: lastCheckAts.length ? new Date(Math.max(...lastCheckAts)).toISOString() : null,
    },
    title: settings?.statusTitle ?? null,
    incidents,
    maintenance: maintenanceList,
    serverTime: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}

