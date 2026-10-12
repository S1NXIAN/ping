import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/ping-auth";
import { db } from "@/lib/db";
import { databaseFileSize } from "@/lib/db-url";
import { MAX_CHECKS_PER_MONITOR, runtimeState } from "@/lib/checker";
import { TICK_INTERVAL_SEC } from "@/lib/scheduler";
import type { AdminInfoResponse } from "@/lib/ping-types";

export async function GET(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const [checksStored, monitors, folders, oldest, settings] = await Promise.all([
    db.check.count(),
    db.monitor.count(),
    db.folder.count(),
    db.check.findFirst({ orderBy: { checkedAt: "asc" }, select: { checkedAt: true } }),
    db.settings.findUnique({ where: { id: "main" }, select: { retentionDays: true } }),
  ]);

  const body: AdminInfoResponse = {
    processUptimeSec: Math.floor(process.uptime()),
    nodeEnv: process.env.NODE_ENV ?? "development",
    scheduler: {
      running: runtimeState.schedulerStarted,
      lastTickAt: runtimeState.lastTickAt,
      lastTickRan: runtimeState.lastTick?.ran ?? 0,
      lastTickDurationMs: runtimeState.lastTick?.durationMs ?? null,
      tickIntervalSec: TICK_INTERVAL_SEC,
    },
    storage: {
      checksStored,
      monitors,
      folders,
      oldestCheckAt: oldest?.checkedAt.toISOString() ?? null,
      dbBytes: databaseFileSize(process.env.DATABASE_URL),
      retentionDays: settings?.retentionDays ?? null,
      maxChecksPerMonitor: MAX_CHECKS_PER_MONITOR,
      lastPrunedAt: runtimeState.lastPrunedAt,
      lastPrunedCount: runtimeState.lastPrunedCount,
    },
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
