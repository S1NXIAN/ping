import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { collectMonitorStats, toMaintenanceDTO, toMonitorDTO, toScheduledPingDTO } from "@/lib/ping-stats";
import type { OverviewResponse, ScheduledPingDTO } from "@/lib/ping-types";

export async function GET(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const [monitors, folders, bundle, pingRows, windowRows] = await Promise.all([
    // Pinned first, then the user's manual order, then oldest-created as a tiebreak.
    db.monitor.findMany({ orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "asc" }] }),
    db.folder.findMany({ orderBy: { createdAt: "asc" } }),
    collectMonitorStats(),
    // Pending (soonest first) + the most recent finished ones.
    db.$transaction([
      db.scheduledPing.findMany({
        where: { status: { in: ["pending", "running"] } },
        orderBy: { runAt: "asc" },
        take: 50,
      }),
      db.scheduledPing.findMany({
        where: { status: "done" },
        orderBy: { ranAt: "desc" },
        take: 20,
      }),
    ]),
    // Active + upcoming windows, plus ones that just ended (for context).
    db.maintenanceWindow.findMany({
      where: { endsAt: { gte: new Date(Date.now() - 2 * 86400_000) } },
      orderBy: { startsAt: "asc" },
      take: 100,
    }),
  ]);

  const folderById = new Map(folders.map((f) => [f.id, f]));
  const dtos = monitors.map((m) =>
    toMonitorDTO(
      m,
      m.folderId ? (folderById.get(m.folderId) ?? null) : null,
      bundle.statsByMonitor.get(m.id),
      bundle.recentByMonitor.get(m.id),
    ),
  );

  const monitorNameById = new Map(monitors.map((m) => [m.id, m.name]));
  const scheduledPings: ScheduledPingDTO[] = [...pingRows[0], ...pingRows[1]]
    .filter((p) => monitorNameById.has(p.monitorId))
    .map((p) => toScheduledPingDTO(p, monitorNameById.get(p.monitorId) ?? "?"));
  const maintenance = windowRows
    .filter((w) => monitorNameById.has(w.monitorId))
    .map((w) => toMaintenanceDTO(w, monitorNameById.get(w.monitorId) ?? "?"));

  const up = dtos.filter((m) => m.enabled && m.lastStatus === "up").length;
  const down = dtos.filter((m) => m.enabled && m.lastStatus === "down").length;
  const paused = dtos.filter((m) => !m.enabled).length;
  const pending = dtos.filter((m) => m.enabled && m.lastStatus === null).length;

  const uptimes = dtos.map((m) => m.stats.uptime24h).filter((u): u is number => u != null);
  const checks24h = dtos.reduce((acc, m) => acc + m.stats.checks24h, 0);
  const monitorsWithFailures24h = dtos.filter((m) => {
    if (!m.stats.uptime24h) return false;
    return m.stats.uptime24h < 1;
  }).length;

  const lastCheckAts = dtos
    .map((m) => m.lastCheckAt)
    .filter((t): t is string => !!t)
    .map((t) => new Date(t).getTime());
  const lastCheckAt = lastCheckAts.length
    ? new Date(Math.max(...lastCheckAts)).toISOString()
    : null;

  const body: OverviewResponse = {
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      createdAt: f.createdAt.toISOString(),
    })),
    monitors: dtos,
    summary: {
      monitors: dtos.length,
      up,
      down,
      paused,
      pending,
      avgUptime24h: uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : null,
      checks24h,
      monitorsWithFailures24h,
      lastCheckAt,
    },
    scheduledPings,
    maintenance,
    serverTime: new Date().toISOString(),
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
