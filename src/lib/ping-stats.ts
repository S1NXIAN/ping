// Aggregations over REAL stored checks — powers /api/overview and
// /api/monitors/[id]. Every number comes from the Check table; when there
// is no data the value is null, never an estimate.
import type { Check, Folder, Monitor } from "@prisma/client";
import { db } from "./db";
import type { CheckDTO, MonitorDTO, MonitorStatsDTO, ScheduledPingDTO } from "./ping-types";

const H24 = 24 * 60 * 60 * 1000;

type StatusCounts = Array<{ monitorId: string; status: string; _count: { _all: number } }>;
type TimingRow = Array<{
  monitorId: string;
  _avg: { responseMs: number | null };
  _min: { responseMs: number | null };
  _max: { responseMs: number | null };
}>;
type AvgRow = Array<{ monitorId: string; _avg: { responseMs: number | null } }>;
type DownRow = Array<{ monitorId: string; _max: { checkedAt: Date | null } }>;
type AllTimeRow = Array<{
  monitorId: string;
  _min: { checkedAt: Date | null };
  _count: { _all: number };
}>;

interface RawCheckRow {
  id: string;
  monitorId: string;
  status: string;
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
  checkedAt: Date | number | string; // prisma sqlite stores epoch-ms INTEGER
}

function toIso(v: Date | number | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v as unknown as string | number).toISOString();
}

export function emptyStats(): MonitorStatsDTO {
  return {
    uptime24h: null,
    uptime7d: null,
    uptime30d: null,
    checks24h: 0,
    avgMs24h: null,
    minMs24h: null,
    maxMs24h: null,
    avgMs7d: null,
    lastDownAt: null,
    firstCheckAt: null,
    totalChecks: 0,
  };
}

export function toCheckDTO(c: Check): CheckDTO {
  return {
    id: c.id,
    status: c.status === "up" ? "up" : "down",
    statusCode: c.statusCode ?? null,
    responseMs: c.responseMs ?? null,
    error: c.error ?? null,
    checkedAt: c.checkedAt.toISOString(),
  };
}

/** Maps a ScheduledPing row to its DTO (monitor name resolved by the caller). */
export function toScheduledPingDTO(
  p: { id: string; monitorId: string; runAt: Date; note: string | null; status: string; ranAt: Date | null; up: boolean | null; statusCode: number | null; responseMs: number | null; error: string | null },
  monitorName: string,
): ScheduledPingDTO {
  return {
    id: p.id,
    monitorId: p.monitorId,
    monitorName,
    runAt: p.runAt.toISOString(),
    note: p.note ?? null,
    status: p.status === "done" ? "done" : p.status === "running" ? "running" : "pending",
    ranAt: p.ranAt?.toISOString() ?? null,
    up: p.up ?? null,
    statusCode: p.statusCode ?? null,
    responseMs: p.responseMs ?? null,
    error: p.error ?? null,
  };
}

function uptime(counts: StatusCounts, monitorId: string): number | null {
  let up = 0;
  let total = 0;
  for (const c of counts) {
    if (c.monitorId !== monitorId) continue;
    total += c._count._all;
    if (c.status === "up") up += c._count._all;
  }
  return total > 0 ? up / total : null;
}

export interface StatsBundle {
  statsByMonitor: Map<string, MonitorStatsDTO>;
  recentByMonitor: Map<string, CheckDTO[]>;
}

/**
 * Collects stats + the most recent checks (last 20 within 48h) for every
 * monitor. Used by the overview endpoint.
 */
export async function collectMonitorStats(): Promise<StatsBundle> {
  const now = Date.now();
  const since24 = new Date(now - H24);
  const since7d = new Date(now - 7 * H24);
  const since30d = new Date(now - 30 * H24);
  const since48hMs = now - 2 * H24; // raw SQL compares against epoch-ms INTEGER

  const [c24, c7, c30, t24, t7, downs, allTime, recentRows] = await Promise.all([
    db.check.groupBy({
      by: ["monitorId", "status"],
      where: { checkedAt: { gte: since24 } },
      _count: { _all: true },
    }) as Promise<StatusCounts>,
    db.check.groupBy({
      by: ["monitorId", "status"],
      where: { checkedAt: { gte: since7d } },
      _count: { _all: true },
    }) as Promise<StatusCounts>,
    db.check.groupBy({
      by: ["monitorId", "status"],
      where: { checkedAt: { gte: since30d } },
      _count: { _all: true },
    }) as Promise<StatusCounts>,
    db.check.groupBy({
      by: ["monitorId"],
      where: { checkedAt: { gte: since24 }, status: "up" },
      _avg: { responseMs: true },
      _min: { responseMs: true },
      _max: { responseMs: true },
    }) as Promise<TimingRow>,
    db.check.groupBy({
      by: ["monitorId"],
      where: { checkedAt: { gte: since7d }, status: "up" },
      _avg: { responseMs: true },
    }) as Promise<AvgRow>,
    db.check.groupBy({
      by: ["monitorId"],
      where: { status: "down" },
      _max: { checkedAt: true },
    }) as Promise<DownRow>,
    db.check.groupBy({
      by: ["monitorId"],
      _min: { checkedAt: true },
      _count: { _all: true },
    }) as Promise<AllTimeRow>,
    db.$queryRaw<RawCheckRow[]>`
      SELECT id, monitorId, status, statusCode, responseMs, error, checkedAt FROM (
        SELECT id, monitorId, status, statusCode, responseMs, error, checkedAt,
               ROW_NUMBER() OVER (PARTITION BY monitorId ORDER BY checkedAt DESC) AS rn
        FROM "Check" WHERE checkedAt >= ${since48hMs}
      ) WHERE rn <= 20
      ORDER BY checkedAt DESC`,
  ]);

  const statsByMonitor = new Map<string, MonitorStatsDTO>();
  const recentByMonitor = new Map<string, CheckDTO[]>();

  const monitorIds = new Set<string>([
    ...c24.map((r) => r.monitorId),
    ...c7.map((r) => r.monitorId),
    ...c30.map((r) => r.monitorId),
    ...t24.map((r) => r.monitorId),
    ...t7.map((r) => r.monitorId),
    ...downs.map((r) => r.monitorId),
    ...allTime.map((r) => r.monitorId),
  ]);

  for (const id of monitorIds) {
    const t24Row = t24.find((r) => r.monitorId === id);
    const t7Row = t7.find((r) => r.monitorId === id);
    const downRow = downs.find((r) => r.monitorId === id);
    const allRow = allTime.find((r) => r.monitorId === id);
    statsByMonitor.set(id, {
      uptime24h: uptime(c24, id),
      uptime7d: uptime(c7, id),
      uptime30d: uptime(c30, id),
      checks24h: (c24 ?? [])
        .filter((r) => r.monitorId === id)
        .reduce((acc, r) => acc + r._count._all, 0),
      avgMs24h: t24Row?._avg.responseMs ?? null,
      minMs24h: t24Row?._min.responseMs ?? null,
      maxMs24h: t24Row?._max.responseMs ?? null,
      avgMs7d: t7Row?._avg.responseMs ?? null,
      lastDownAt: downRow?._max.checkedAt?.toISOString() ?? null,
      firstCheckAt: allRow?._min.checkedAt?.toISOString() ?? null,
      totalChecks: allRow?._count._all ?? 0,
    });
  }

  for (const row of recentRows) {
    const list = recentByMonitor.get(row.monitorId) ?? [];
    const dto: CheckDTO = {
      id: row.id,
      status: row.status === "up" ? "up" : "down",
      statusCode: row.statusCode ?? null,
      responseMs: row.responseMs ?? null,
      error: row.error ?? null,
      checkedAt: toIso(row.checkedAt),
    };
    list.push(dto);
    recentByMonitor.set(row.monitorId, list);
  }

  return { statsByMonitor, recentByMonitor };
}

export function toMonitorDTO(
  monitor: Monitor,
  folder: Folder | null,
  stats: MonitorStatsDTO | undefined,
  recent: CheckDTO[] | undefined,
): MonitorDTO {
  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    method: monitor.method === "HEAD" ? "HEAD" : "GET",
    intervalSec: monitor.intervalSec,
    enabled: monitor.enabled,
    folderId: monitor.folderId,
    folderName: folder?.name ?? null,
    account: monitor.account ?? null,
    pinned: monitor.pinned,
    position: monitor.position,
    createdAt: monitor.createdAt.toISOString(),
    lastCheckAt: monitor.lastCheckAt?.toISOString() ?? null,
    lastStatus:
      monitor.lastStatus === "up" || monitor.lastStatus === "down" ? monitor.lastStatus : null,
    lastStatusCode: monitor.lastStatusCode ?? null,
    lastResponseMs: monitor.lastResponseMs ?? null,
    lastError: monitor.lastError ?? null,
    stats: stats ?? emptyStats(),
    recentChecks: recent ?? [],
  };
}

/** p95 response time over the last 24h (real values, up checks only). */
export async function p95For(monitorId: string): Promise<number | null> {
  const since = new Date(Date.now() - H24);
  const vals = await db.check.findMany({
    where: {
      monitorId,
      status: "up",
      responseMs: { not: null },
      checkedAt: { gte: since },
    },
    select: { responseMs: true },
  });
  const nums = vals
    .map((v) => v.responseMs)
    .filter((n): n is number => typeof n === "number" && !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = Math.min(nums.length - 1, Math.ceil(0.95 * nums.length) - 1);
  return nums[idx] ?? null;
}

/** Daily up/down buckets for the last 30 days (only days with real checks). */
export async function dailyBuckets(monitorId: string): Promise<
  Array<{ date: string; up: number; down: number }>
> {
  const sinceMs = Date.now() - 30 * H24; // epoch ms, matching sqlite storage
  const rows = await db.$queryRaw<Array<{ day: string; status: string; cnt: number }>>`
    SELECT date(checkedAt / 1000, 'unixepoch') AS day, status, COUNT(*) AS cnt FROM "Check"
    WHERE monitorId = ${monitorId} AND checkedAt >= ${sinceMs}
    GROUP BY day, status
    ORDER BY day ASC`;
  const map = new Map<string, { up: number; down: number }>();
  for (const r of rows) {
    const cnt = Number(r.cnt); // COUNT(*) arrives as BigInt
    const entry = map.get(r.day) ?? { up: 0, down: 0 };
    if (r.status === "up") entry.up += cnt;
    else entry.down += cnt;
    map.set(r.day, entry);
  }
  return Array.from(map.entries()).map(([date, v]) => ({ date, ...v }));
}
