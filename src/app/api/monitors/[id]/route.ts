import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { KEYWORD_MAX_LENGTH } from "@/lib/checker";
import { monitorUrlSchema, intervalSecSchema, scheduleFields, scheduleError, methodKeywordError } from "@/lib/validation";
import {
  collectMonitorStats,
  dailyBuckets,
  toCheckDTO,
  toMonitorDTO,
  p95For,
  emptyStats,
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

  // All aggregates in one shared pass — the SAME collectMonitorStats the
  // overview uses, scoped to this monitor. Computing them here by hand was a
  // second copy of the uptime/latency rules that could drift from the card's.
  const [folder, checks, daily, p95, bundle] = await Promise.all([
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
    collectMonitorStats([id]),
  ]);

  // The sheet's check table: the 100 newest recorded checks (any status).
  const latestChecks = checks.map(toCheckDTO);
  const stats = bundle.statsByMonitor.get(id) ?? emptyStats();
  // The slow-state window is the same recent-checks window the card shows
  // (RECENT_CHECKS within 48h), which collectMonitorStats already narrowed.
  const recentWindow = bundle.recentByMonitor.get(id) ?? [];

  const body: MonitorDetailResponse = {
    monitor: toMonitorDTO(monitor, folder, stats, recentWindow),
    p95Ms24h: p95,
    daily,
    checks: latestChecks,
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
  // Method/keyword pairing, checked against the RESULTING state so a patch
  // that only flips the method still validates against the stored keyword
  // (and vice versa) — the same guarded shape as the schedule rule above.
  if (method !== undefined || keyword !== undefined) {
    const methodErr = methodKeywordError({
      method: method ?? (monitor.method === "HEAD" ? "HEAD" : "GET"),
      keyword: keyword !== undefined ? keyword ?? null : monitor.keyword,
    });
    if (methodErr) return NextResponse.json({ error: methodErr }, { status: 400 });
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
