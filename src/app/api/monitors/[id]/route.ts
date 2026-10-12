import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { KEYWORD_MAX_LENGTH } from "@/lib/checker";
import { monitorUrlSchema, intervalSecSchema, scheduleFields, scheduleError } from "@/lib/validation";
import {
  dailyBuckets,
  toCheckDTO,
  toMonitorDTO,
  p95For,
  emptyStats,
  RECENT_CHECKS,
} from "@/lib/ping-stats";
import { disableSelfMonitor } from "@/lib/self-monitor";
import type { MonitorDetailResponse } from "@/lib/ping-types";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const monitor = await db.monitor.findUnique({ where: { id } });
  if (!monitor) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }

  const now = Date.now();
  const H24 = 86400_000;
  const since24 = new Date(now - H24);
  const since7d = new Date(now - 7 * H24);
  const since30d = new Date(now - 30 * H24);
  // "Last down" bounded to the incident lookback (32 d): keeps the query
  // cheap under keep-forever retention; older downs can't surface in the UI.
  const sinceDowns = new Date(now - 32 * H24);

  // All aggregates in one parallel round — 24h stats come from SQL groupBys,
  // not from the 100-check slice below (a 60 s interval only covers ~100
  // minutes, so "24h" computed from it would be a lie).
  const [folder, checks, daily, p95, c24, t24, c7, c30, t7, lastDown, firstCheck, totalChecks] =
    await Promise.all([
      monitor.folderId
        ? db.folder.findUnique({ where: { id: monitor.folderId } })
        : null,
      db.check.findMany({
        where: { monitorId: id },
        orderBy: { checkedAt: "desc" },
        take: 100,
      }),
      dailyBuckets(id),
      p95For(id),
      db.check.groupBy({
        by: ["status"],
        where: { monitorId: id, checkedAt: { gte: since24 } },
        _count: { _all: true },
      }),
      db.check.groupBy({
        by: ["status"],
        where: { monitorId: id, checkedAt: { gte: since24 }, status: "up" },
        _avg: { responseMs: true },
        _min: { responseMs: true },
        _max: { responseMs: true },
      }),
      db.check.groupBy({
        by: ["status"],
        where: { monitorId: id, checkedAt: { gte: since7d } },
        _count: { _all: true },
      }),
      db.check.groupBy({
        by: ["status"],
        where: { monitorId: id, checkedAt: { gte: since30d } },
        _count: { _all: true },
      }),
      db.check.groupBy({
        by: ["status"],
        where: { monitorId: id, checkedAt: { gte: since7d }, status: "up" },
        _avg: { responseMs: true },
      }),
      db.check.findFirst({
        where: { monitorId: id, status: "down", checkedAt: { gte: sinceDowns } },
        orderBy: { checkedAt: "desc" },
        select: { checkedAt: true },
      }),
      db.check.findFirst({
        where: { monitorId: id },
        orderBy: { checkedAt: "asc" },
        select: { checkedAt: true },
      }),
      db.check.count({ where: { monitorId: id } }),
    ]);

  // Build the same stats shape the overview uses, but scoped to this monitor.
  const recent = checks.map(toCheckDTO);

  const up24 = c24.find((r) => r.status === "up")?._count._all ?? 0;
  const total24 = c24.reduce((acc, r) => acc + r._count._all, 0);
  const timing24 = t24.find((r) => r.status === "up");
  const up7 = c7.find((r) => r.status === "up")?._count._all ?? 0;
  const total7 = c7.reduce((acc, r) => acc + r._count._all, 0);
  const up30 = c30.find((r) => r.status === "up")?._count._all ?? 0;
  const total30 = c30.reduce((acc, r) => acc + r._count._all, 0);

  const stats = {
    ...emptyStats(),
    uptime24h: total24 > 0 ? up24 / total24 : null,
    checks24h: total24,
    avgMs24h: timing24?._avg.responseMs ?? null,
    minMs24h: timing24?._min.responseMs ?? null,
    maxMs24h: timing24?._max.responseMs ?? null,
    uptime7d: total7 > 0 ? up7 / total7 : null,
    uptime30d: total30 > 0 ? up30 / total30 : null,
    avgMs7d: t7.find((r) => r.status === "up")?._avg.responseMs ?? null,
    lastDownAt: lastDown?.checkedAt.toISOString() ?? null,
    firstCheckAt: firstCheck?.checkedAt.toISOString() ?? null,
    totalChecks,
  };

  // The card bars' window is the last RECENT_CHECKS checks within 48h. The
  // detail sheet's slow state must read that same window, or a long-interval
  // monitor would disagree with its own card.
  const since48h = new Date(now - 2 * H24);
  const recentWindow = recent
    .filter((c) => new Date(c.checkedAt).getTime() >= since48h.getTime())
    .slice(0, RECENT_CHECKS);

  const body: MonitorDetailResponse = {
    monitor: toMonitorDTO(monitor, folder, stats, recentWindow),
    p95Ms24h: p95,
    daily,
    checks: recent,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

const patchSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").max(80).optional(),
  url: monitorUrlSchema.optional(),
  folderId: z.string().trim().min(1).nullish(),
  intervalSec: intervalSecSchema.optional(),
  enabled: z.boolean().optional(),
  method: z.enum(["GET", "HEAD"]).optional(),
  pinned: z.boolean().optional(),
  account: z.string().trim().max(60, "Account label is too long (60 chars max)").nullish(),
  /** Keyword check: body must contain (or not contain) this string; null clears (off). */
  keyword: z
    .string()
    .trim()
    .min(1, "Keyword cannot be empty — clear the field to turn the check off")
    .max(KEYWORD_MAX_LENGTH, `Keyword is too long (${KEYWORD_MAX_LENGTH} chars max)`)
    .nullish(),
  keywordMode: z.enum(["contains", "excludes"]).optional(),
  /** Latency threshold in ms; null clears (off). */
  slowThresholdMs: z
    .number()
    .int()
    .min(50, "Threshold must be at least 50 ms")
    .max(30000, "Threshold must be at most 30000 ms")
    .nullish(),
  ...scheduleFields,
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const monitor = await db.monitor.findUnique({ where: { id } });
  if (!monitor) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  const { name, url, folderId, intervalSec, enabled, method, pinned, account, keyword, keywordMode, slowThresholdMs, scheduleMode, scheduleTimes, timezone } = parsed.data;
  if (name !== undefined) data.name = name;
  if (url !== undefined) data.url = url;
  if (intervalSec !== undefined) data.intervalSec = intervalSec;
  if (enabled !== undefined) data.enabled = enabled;
  if (method !== undefined) data.method = method;
  if (pinned !== undefined) data.pinned = pinned;
  if (slowThresholdMs !== undefined) data.slowThresholdMs = slowThresholdMs ?? null;
  // Schedule: the mode decides which fields are meaningful. Switching to
  // interval clears the times/zone (an interval monitor has neither); switching
  // to times requires both. The cross-field rule is checked against the
  // resulting state, so a patch that only flips the mode still validates.
  if (scheduleMode !== undefined || scheduleTimes !== undefined || timezone !== undefined) {
    const nextMode = scheduleMode ?? (monitor.scheduleMode === "times" ? "times" : "interval");
    const nextTimes = scheduleTimes !== undefined ? scheduleTimes : monitor.scheduleTimes;
    const nextZone = timezone !== undefined ? timezone : monitor.timezone;
    const schedErr = scheduleError({
      scheduleMode: nextMode,
      scheduleTimes: nextTimes,
      timezone: nextZone,
    });
    if (schedErr) return NextResponse.json({ error: schedErr }, { status: 400 });
    data.scheduleMode = nextMode;
    data.scheduleTimes = nextMode === "times" ? (nextTimes ?? null) : null;
    data.timezone = nextMode === "times" ? (nextZone ?? null) : null;
  }
  // absent → untouched; null or "" → off; string → set
  if (keyword !== undefined) {
    data.keyword = keyword === "" ? null : keyword ?? null;
  }
  if (keywordMode !== undefined) {
    data.keywordMode = keywordMode;
  }
  // absent → untouched; null or "" → cleared; string → set
  if (account !== undefined) data.account = account === "" ? null : account;
  if (folderId !== undefined) {
    if (folderId === null) {
      data.folderId = null;
    } else {
      const folder = await db.folder.findUnique({ where: { id: folderId } });
      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 400 });
      }
      data.folderId = folderId;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await db.monitor.update({ where: { id }, data });
  return NextResponse.json({ ok: true, id: updated.id });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const exists = await db.monitor.findUnique({
    where: { id },
    select: { id: true, isSelfMonitor: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }
  await db.monitor.delete({ where: { id } }); // checks cascade
  // Deleting the Self-monitor is the operator's choice — record it so a later
  // boot or request never recreates it against their wishes.
  if (exists.isSelfMonitor) await disableSelfMonitor();
  return NextResponse.json({ ok: true });
}
