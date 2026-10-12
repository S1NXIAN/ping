// Aggregations over REAL stored checks — powers /api/overview and
// /api/monitors/[id]. Every number comes from the Check table; when there
// is no data the value is null, never an estimate.
import type { Check, Folder, Monitor } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { parseTimes } from "./schedule";
import { isDegraded } from "./monitor-status";
import type { CheckDTO, DailyBucket, MonitorDTO, MonitorStatsDTO, WebhookChannelDTO } from "./ping-types";

const H24 = 24 * 60 * 60 * 1000;

/** Shape of a groupBy(monitorId, status) count result. */
type StatusCounts = Array<{ monitorId: string; status: string; _count: { _all: number } }>;

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

/** Maps a WebhookChannel row (+ its monitor's name) to its DTO. */
export function toWebhookChannelDTO(
  ch: {
    id: string;
    name: string;
    url: string;
    monitorId: string | null;
    notifyDown: boolean;
    notifyUp: boolean;
    notifySlow: boolean;
    enabled: boolean;
    createdAt: Date;
    deliveries: number;
    lastDeliveryAt: Date | null;
    lastOk: boolean | null;
    lastError: string | null;
  },
  monitorName: string | null,
): WebhookChannelDTO {
  return {
    ...ch,
    monitorName,
    createdAt: ch.createdAt.toISOString(),
    lastDeliveryAt: ch.lastDeliveryAt?.toISOString() ?? null,
  };
}

/** One pass over a groupBy(monitorId, status) result → uptime fraction per monitor. */
function uptimeByMonitor(counts: StatusCounts): Map<string, number> {
  const totals = new Map<string, { up: number; total: number }>();
  for (const c of counts) {
    const e = totals.get(c.monitorId) ?? { up: 0, total: 0 };
    e.total += c._count._all;
    if (c.status === "up") e.up += c._count._all;
    totals.set(c.monitorId, e);
  }
  const out = new Map<string, number>();
  for (const [id, e] of totals) if (e.total > 0) out.set(id, e.up / e.total);
  return out;
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
  // "Last down" is only ever displayed/needed within the incident lookback
  // (30 d + buffer) — older downs can't surface anywhere in the UI, so the
  // lookup stays bounded even under the keep-forever retention policy.
  const sinceDowns = new Date(now - 32 * H24);
  const since48hMs = now - 2 * H24; // raw SQL compares against epoch-ms INTEGER

  const [c24, c7, c30, t24, t7, downs, allTime, recentRows] = await Promise.all([
    db.check.groupBy({
      by: ["monitorId", "status"],
      where: { checkedAt: { gte: since24 } },
      _count: { _all: true },
    }),
    db.check.groupBy({
      by: ["monitorId", "status"],
      where: { checkedAt: { gte: since7d } },
      _count: { _all: true },
    }),
    db.check.groupBy({
      by: ["monitorId", "status"],
      where: { checkedAt: { gte: since30d } },
      _count: { _all: true },
    }),
    db.check.groupBy({
      by: ["monitorId"],
      where: { checkedAt: { gte: since24 }, status: "up" },
      _avg: { responseMs: true },
      _min: { responseMs: true },
      _max: { responseMs: true },
    }),
    db.check.groupBy({
      by: ["monitorId"],
      where: { checkedAt: { gte: since7d }, status: "up" },
      _avg: { responseMs: true },
    }),
    db.check.groupBy({
      by: ["monitorId"],
      where: { status: "down", checkedAt: { gte: sinceDowns } },
      _max: { checkedAt: true },
    }),
    db.check.groupBy({
      by: ["monitorId"],
      _min: { checkedAt: true },
      _count: { _all: true },
    }),
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

  // Index the grouped rows by monitor once — the per-monitor lookups below
  // used to be a .find() over each result set (O(monitors²) on every poll).
  const index = <T extends { monitorId: string }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) m.set(r.monitorId, r);
    return m;
  };
  const t24By = index(t24);
  const t7By = index(t7);
  const downsBy = index(downs);
  const allTimeBy = index(allTime);
  const checks24By = new Map<string, number>();
  for (const r of c24) checks24By.set(r.monitorId, (checks24By.get(r.monitorId) ?? 0) + r._count._all);
  const up24By = uptimeByMonitor(c24);
  const up7By = uptimeByMonitor(c7);
  const up30By = uptimeByMonitor(c30);

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
    const t24Row = t24By.get(id);
    const t7Row = t7By.get(id);
    const downRow = downsBy.get(id);
    const allRow = allTimeBy.get(id);
    statsByMonitor.set(id, {
      uptime24h: up24By.get(id) ?? null,
      uptime7d: up7By.get(id) ?? null,
      uptime30d: up30By.get(id) ?? null,
      checks24h: checks24By.get(id) ?? 0,
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
    scheduleMode: monitor.scheduleMode === "times" ? "times" : "interval",
    scheduleTimes: parseTimes(monitor.scheduleTimes),
    timezone: monitor.timezone ?? null,
    enabled: monitor.enabled,
    folderId: monitor.folderId,
    folderName: folder?.name ?? null,
    account: monitor.account ?? null,
    pinned: monitor.pinned,
    position: monitor.position,
    keyword: monitor.keyword ?? null,
    keywordMode: monitor.keywordMode === "excludes" ? "excludes" : "contains",
    slowThresholdMs: monitor.slowThresholdMs ?? null,
    alertDelay: monitor.alertDelay ?? 0,
    consecutiveDowns: monitor.consecutiveDowns ?? 0,
    degraded: isDegraded(monitor),
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
export async function dailyBuckets(monitorId: string): Promise<DailyBucket[]> {
  const map = await dailyBucketsByMonitor([monitorId]);
  return map.get(monitorId) ?? [];
}

/**
 * Daily up/down buckets for many monitors at once — ONE grouped query for
 * the whole fleet (a per-monitor loop was 200+ queries at the monitor cap).
 * Monitors with no checks in the window simply have no map entry.
 */
export async function dailyBucketsByMonitor(
  monitorIds: string[],
): Promise<Map<string, DailyBucket[]>> {
  const result = new Map<string, DailyBucket[]>();
  if (monitorIds.length === 0) return result;

  const sinceMs = Date.now() - 30 * H24; // epoch ms, matching sqlite storage
  const rows = await db.$queryRaw<Array<{ monitorId: string; day: string; status: string; cnt: number }>>`
    SELECT monitorId, date(checkedAt / 1000, 'unixepoch') AS day, status, COUNT(*) AS cnt
    FROM "Check"
    WHERE monitorId IN (${Prisma.join(monitorIds)}) AND checkedAt >= ${sinceMs}
    GROUP BY monitorId, day, status
    ORDER BY monitorId ASC, day ASC`;

  for (const r of rows) {
    const cnt = Number(r.cnt); // COUNT(*) arrives as BigInt
    const list = result.get(r.monitorId) ?? [];
    const last = list[list.length - 1];
    if (last && last.date === r.day) {
      if (r.status === "up") last.up += cnt;
      else last.down += cnt;
    } else {
      list.push({ date: r.day, up: r.status === "up" ? cnt : 0, down: r.status === "up" ? 0 : cnt });
    }
    result.set(r.monitorId, list);
  }
  return result;
}
