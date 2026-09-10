import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
import { KEYWORD_MAX_LENGTH } from "@/lib/checker";
import { dailyBuckets, toCheckDTO, toMonitorDTO, p95For, emptyStats } from "@/lib/ping-stats";
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

  const body: MonitorDetailResponse = {
    monitor: toMonitorDTO(monitor, folder, stats, recent.slice(0, 20)),
    p95Ms24h: p95,
    daily,
    checks: recent,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

const patchSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").max(80).optional(),
  url: z
    .string()
    .trim()
    .min(4)
    .max(500)
    .refine((v) => {
      try {
        const u = new URL(v);
        return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
      } catch {
        return false;
      }
    }, "Enter a valid http(s) URL")
    .optional(),
  folderId: z.string().trim().min(1).nullish(),
  intervalSec: z.number().int().min(60).max(86400).optional(),
  enabled: z.boolean().optional(),
  method: z.enum(["GET", "HEAD"]).optional(),
  pinned: z.boolean().optional(),
  statusHidden: z.boolean().optional(),
  account: z.string().trim().max(60, "Account label is too long (60 chars max)").nullish(),
  /** Keyword check: body must contain (or not contain) this string; null clears (off). */
  keyword: z
    .string()
    .trim()
    .min(1, "Keyword cannot be empty — clear the field to turn the check off")
    .max(KEYWORD_MAX_LENGTH, `Keyword is too long (${KEYWORD_MAX_LENGTH} chars max)`)
    .nullish(),
  keywordMode: z.enum(["contains", "excludes"]).optional(),
  /** Latency-alert threshold in ms; null clears (off). */
  slowThresholdMs: z
    .number()
    .int()
    .min(50, "Threshold must be at least 50 ms")
    .max(30000, "Threshold must be at most 30000 ms")
    .nullish(),
  /** Extra consecutive failed checks before a down webhook (0–10). */
  alertDelay: z
    .number()
    .int()
    .min(0, "Alert delay must be 0 or more")
    .max(10, "Alert delay can be at most 10 extra checks")
    .optional(),
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
  const { name, url, folderId, intervalSec, enabled, method, pinned, statusHidden, account, keyword, keywordMode, slowThresholdMs, alertDelay } = parsed.data;
  if (name !== undefined) data.name = name;
  if (url !== undefined) data.url = url;
  if (intervalSec !== undefined) data.intervalSec = intervalSec;
  if (enabled !== undefined) data.enabled = enabled;
  if (method !== undefined) data.method = method;
  if (pinned !== undefined) data.pinned = pinned;
  if (statusHidden !== undefined) data.statusHidden = statusHidden;
  if (slowThresholdMs !== undefined) data.slowThresholdMs = slowThresholdMs ?? null;
  if (alertDelay !== undefined) {
    data.alertDelay = alertDelay;
    // A changed confirmation policy makes the old streak meaningless.
    data.consecutiveDowns = 0;
  }
  // absent → untouched; null or "" → off; string → set. A changed keyword
  // (or mode) re-targets the check semantics, so the failure streak resets —
  // the same rule a URL change follows.
  if (keyword !== undefined) {
    data.keyword = keyword === "" ? null : keyword ?? null;
    if ((data.keyword ?? null) !== (monitor.keyword ?? null)) data.consecutiveDowns = 0;
  }
  if (keywordMode !== undefined) {
    data.keywordMode = keywordMode;
    if (keywordMode !== monitor.keywordMode && monitor.keyword) data.consecutiveDowns = 0;
  }
  // A new target is a fresh start — the old failure streak must not count
  // against (or for) the new URL.
  if (url !== undefined && url !== monitor.url) data.consecutiveDowns = 0;
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
  const exists = await db.monitor.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
  }
  await db.monitor.delete({ where: { id } }); // checks cascade
  return NextResponse.json({ ok: true });
}
