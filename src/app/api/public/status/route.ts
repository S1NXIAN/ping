import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { collectMonitorStats, dailyBuckets } from "@/lib/ping-stats";
import type { PublicStatusMonitor, PublicStatusResponse } from "@/lib/ping-types";

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
    serverTime: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
