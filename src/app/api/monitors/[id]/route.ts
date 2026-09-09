import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/ping-auth";
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

  const [folder, checks, daily, p95] = await Promise.all([
    monitor.folderId
      ? db.folder.findUnique({ where: { id: monitor.folderId } })
      : Promise.resolve(null),
    db.check.findMany({
      where: { monitorId: id },
      orderBy: { checkedAt: "desc" },
      take: 100,
    }),
    dailyBuckets(id),
    p95For(id),
  ]);

  // Build the same stats shape the overview uses, but scoped to this monitor.
  const now = Date.now();
  const H24 = 86400_000;
  const since = new Date(now - H24);
  const recent = checks.map(toCheckDTO);
  const last24 = recent.filter((c) => new Date(c.checkedAt).getTime() >= since.getTime());
  const up24 = last24.filter((c) => c.status === "up");
  const responseTimes = up24.map((c) => c.responseMs).filter((v): v is number => v != null);

  const stats = {
    ...emptyStats(),
    uptime24h: last24.length ? up24.length / last24.length : null,
    checks24h: last24.length,
    avgMs24h: responseTimes.length
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null,
    minMs24h: responseTimes.length ? Math.min(...responseTimes) : null,
    maxMs24h: responseTimes.length ? Math.max(...responseTimes) : null,
    totalChecks: await db.check.count({ where: { monitorId: id } }),
  };

  // 7d / 30d uptime + lastDown + firstCheck from grouped queries
  const c7 = await db.check.groupBy({
    by: ["status"],
    where: { monitorId: id, checkedAt: { gte: new Date(now - 7 * H24) } },
    _count: { _all: true },
  });
  const c30 = await db.check.groupBy({
    by: ["status"],
    where: { monitorId: id, checkedAt: { gte: new Date(now - 30 * H24) } },
    _count: { _all: true },
  });
  const t7 = await db.check.groupBy({
    by: ["status"],
    where: { monitorId: id, checkedAt: { gte: new Date(now - 7 * H24) }, status: "up" },
    _avg: { responseMs: true },
  });
  const lastDown = await db.check.findFirst({
    where: { monitorId: id, status: "down" },
    orderBy: { checkedAt: "desc" },
  });
  const firstCheck = await db.check.findFirst({
    where: { monitorId: id },
    orderBy: { checkedAt: "asc" },
  });

  const up7 = c7.find((r) => r.status === "up")?._count._all ?? 0;
  const total7 = c7.reduce((acc, r) => acc + r._count._all, 0);
  const up30 = c30.find((r) => r.status === "up")?._count._all ?? 0;
  const total30 = c30.reduce((acc, r) => acc + r._count._all, 0);

  stats.uptime7d = total7 > 0 ? up7 / total7 : null;
  stats.uptime30d = total30 > 0 ? up30 / total30 : null;
  stats.avgMs7d = t7.find((r) => r.status === "up")?._avg.responseMs ?? null;
  stats.lastDownAt = lastDown?.checkedAt.toISOString() ?? null;
  stats.firstCheckAt = firstCheck?.checkedAt.toISOString() ?? null;

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
  const { name, url, folderId, intervalSec, enabled, method, pinned, statusHidden, account, slowThresholdMs, alertDelay } = parsed.data;
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
