import { NextRequest, NextResponse } from "next/server";
import { statSync } from "node:fs";
import { adminGuard } from "@/lib/ping-auth";
import { db } from "@/lib/db";
import { RETENTION_DAYS, MAX_CHECKS_PER_MONITOR, runtimeState } from "@/lib/checker";
import { TICK_INTERVAL_SEC } from "@/lib/scheduler";
import type { AdminInfoResponse } from "@/lib/ping-types";

function dbBytes(): number | null {
  try {
    const url = process.env.DATABASE_URL ?? "";
    const path = url.startsWith("file:") ? url.slice(5) : url;
    if (!path) return null;
    return statSync(path).size;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const [checksStored, monitors, folders, oldest] = await Promise.all([
    db.check.count(),
    db.monitor.count(),
    db.folder.count(),
    db.check.findFirst({ orderBy: { checkedAt: "asc" }, select: { checkedAt: true } }),
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
      dbBytes: dbBytes(),
      retentionDays: RETENTION_DAYS,
      maxChecksPerMonitor: MAX_CHECKS_PER_MONITOR,
    },
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
