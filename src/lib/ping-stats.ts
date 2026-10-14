// Aggregations over REAL stored checks — powers /api/overview and
// /api/monitors/[id]. Every number comes from the Check table; when there
// is no data the value is null, never an estimate.
import type { Check, Folder, Monitor } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { parseTimes } from "./schedule";
import { isDegraded } from "./monitor-status";
import { INCIDENT_LOOKBACK_DAYS } from "./incidents";
import type { CheckDTO, DailyBucket, MonitorDTO, MonitorStatsDTO } from "./ping-types";

const H24 = 24 * 60 * 60 * 1000;

/**
 * The recent-checks window: how many of the newest checks within 48h the card
 * bars show. One window, one meaning — the slow verdict averages the same
 * checks, so the overview and the detail route (which both call
 * collectMonitorStats) can never disagree.
 */
export const RECENT_CHECKS = 12;

/** Rows from the collapsed uptime-count query (24h/7d/30d in one scan).
 *  SQLite returns SUM/COUNT as BigInt. */
interface CountsRow {
  monitorId: string;
  up24: number | bigint;
  total24: number | bigint;
  up7: number | bigint;
  total7: number | bigint;
  up30: number | bigint;
  total30: number | bigint;
}

/** Rows from the collapsed latency query (24h avg/min/max + 7d avg). */
interface TimingRow {
  monitorId: string;
  avg24: number | null;
  min24: number | null;
  max24: number | null;
  avg7: number | null;
}

interface RawCheckRow {
  id: string;
  monitorId: string;
  status: string;
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
  checkedAt: Date | number | string; // prisma sqlite stores epoch-ms INTEGER
}

/** Rows from the collapsed all-time query (total checks + first check). */
interface AllTimeRow {
  monitorId: string;
  firstCheck: Date | number | string;
  total: number;
}

function toIso(v: Date | number | string | bigint): string {
  return v instanceof Date ? v.toISOString() : new Date(Number(v)).toISOString();
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
export function toCheckDTO(
  c: Omit<Check, "checkedAt"> & { checkedAt: Date | number | string | bigint },
): CheckDTO {
  return {
    id: c.id,
    status: c.status === "up" ? "up" : "down",
    statusCode: c.statusCode ?? null,
    responseMs: c.responseMs ?? null,
    error: c.error ?? null,
    checkedAt: toIso(c.checkedAt),
  };
}

export interface StatsBundle {
  statsByMonitor: Map<string, MonitorStatsDTO>;
  recentByMonitor: Map<string, CheckDTO[]>;
}

/**
 * Collects stats + the most recent checks (RECENT_CHECKS within 48h) for every
 * monitor, or for just `onlyMonitorIds` when given. Used by the overview and
 * (scoped to one monitor) by the detail route, so both compute a monitor's
 * stats the same way and can never disagree.
 *
 * `includeAllTime` controls the totalChecks/firstCheckAt pair. That query has
 * no date bound, so under "keep forever" it scans the whole Check table; only
 * the detail sheet shows those two values, so the 15s overview poll opts out
 * (pass false) and gets null — "not computed", never a fabricated 0.
 */
export async function collectMonitorStats(
  onlyMonitorIds?: string[],
  { includeAllTime = true }: { includeAllTime?: boolean } = {},
): Promise<StatsBundle> {
  const now = Date.now();
  // An empty scope means "no monitors" — return nothing rather than letting
  // Prisma.join([]) throw.
  if (onlyMonitorIds && onlyMonitorIds.length === 0) {
    return { statsByMonitor: new Map(), recentByMonitor: new Map() };
  }
  const t24 = now - H24;
  const t7 = now - 7 * H24;
  const t30 = now - 30 * H24;
  // "Last down" is only ever displayed/needed within the incident lookback —
  // older downs can't surface anywhere in the UI, so the lookup stays bounded
  // even under the keep-forever retention policy.
  const t32 = now - INCIDENT_LOOKBACK_DAYS * H24;
  const since48hMs = now - 2 * H24; // raw SQL compares against epoch-ms INTEGER
  // Scope every query to the requested monitors (all of them by default).
  const idFilter = onlyMonitorIds
    ? Prisma.sql`AND monitorId IN (${Prisma.join(onlyMonitorIds)})`
    : Prisma.empty;

  // Uptime counts for 24h/7d/30d in ONE scan (conditional aggregation), and
  // latency for 24h/7d in a second. Five windowed groupBys over the same rows
  // meant five index scans of the whole window; two passes with CASE sums read
  // the rows once each. Same numbers, measured ~5x faster at the 200k ceiling.
  // The all-time pass is skipped when not requested (see the doc above).
  const [counts, timing, downs, allTime] = await Promise.all([
    db.$queryRaw<CountsRow[]>`
      SELECT monitorId,
        SUM(CASE WHEN checkedAt >= ${t24} AND status = 'up' THEN 1 ELSE 0 END) AS up24,
        SUM(CASE WHEN checkedAt >= ${t24} THEN 1 ELSE 0 END) AS total24,
        SUM(CASE WHEN checkedAt >= ${t7} AND status = 'up' THEN 1 ELSE 0 END) AS up7,
        SUM(CASE WHEN checkedAt >= ${t7} THEN 1 ELSE 0 END) AS total7,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up30,
        COUNT(*) AS total30
      FROM "Check" WHERE checkedAt >= ${t30} ${idFilter} GROUP BY monitorId`,
    db.$queryRaw<TimingRow[]>`
      SELECT monitorId,
        AVG(CASE WHEN checkedAt >= ${t24} THEN responseMs END) AS avg24,
        MIN(CASE WHEN checkedAt >= ${t24} THEN responseMs END) AS min24,
        MAX(CASE WHEN checkedAt >= ${t24} THEN responseMs END) AS max24,
        AVG(CASE WHEN checkedAt >= ${t7} THEN responseMs END) AS avg7
      FROM "Check" WHERE status = 'up' AND checkedAt >= ${t7} ${idFilter} GROUP BY monitorId`,
    db.$queryRaw<{ monitorId: string; lastDown: Date | number | string }[]>`
      SELECT monitorId, MAX(checkedAt) AS lastDown
      FROM "Check" WHERE status = 'down' AND checkedAt >= ${t32} ${idFilter} GROUP BY monitorId`,
    includeAllTime
      ? db.$queryRaw<AllTimeRow[]>`
          SELECT monitorId, MIN(checkedAt) AS firstCheck, COUNT(*) AS total
          FROM "Check" WHERE 1=1 ${idFilter} GROUP BY monitorId`
      : Promise.resolve([] as AllTimeRow[]),
  ]);

  // The most-recent-N-per-monitor window. A single window-function query
  // (ROW_NUMBER() OVER (PARTITION BY monitorId …)) has to sort EVERY check in
  // the 48h window before it can rank them — at the 200-monitor / 1000-check
  // ceiling that is ~100k rows sorted per poll (~700ms on this hardware), on
  // every 15s dashboard refresh. One UNION ALL of per-monitor LIMITs lets the
  // (monitorId, checkedAt) index answer each branch with a seek + LIMIT and no
  // sort: same rows, ~20x faster, still ONE round trip. Empty fleet → no query.
  const windowIds = onlyMonitorIds ?? (await db.monitor.findMany({ select: { id: true } })).map((m) => m.id);
  const recentRows =
    windowIds.length === 0
      ? []
      : await db.$queryRaw<RawCheckRow[]>`
          SELECT * FROM (${Prisma.join(
            windowIds.map(
              (id) => Prisma.sql`SELECT * FROM (
                SELECT id, monitorId, status, statusCode, responseMs, error, checkedAt
                FROM "Check" WHERE monitorId = ${id} AND checkedAt >= ${since48hMs}
                ORDER BY checkedAt DESC LIMIT ${RECENT_CHECKS})`,
            ),
            " UNION ALL ",
          )}) ORDER BY checkedAt DESC`;

  const statsByMonitor = new Map<string, MonitorStatsDTO>();
  const recentByMonitor = new Map<string, CheckDTO[]>();

  // Index the rows by monitor once, then build each monitor's stats.
  const index = <T extends { monitorId: string }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) m.set(r.monitorId, r);
    return m;
  };
  const countsBy = index(counts);
  const timingBy = index(timing);
  const downsBy = index(downs);
  const allTimeBy = index(allTime);

  const monitorIds = new Set<string>([
    ...counts.map((r) => r.monitorId),
    ...timing.map((r) => r.monitorId),
    ...downs.map((r) => r.monitorId),
    ...allTime.map((r) => r.monitorId),
  ]);

  // SQLite returns SUM/COUNT as BigInt and AVG as a float — normalise to the
  // number/null shape the DTO promises.
  const num = (v: number | bigint | null | undefined): number | null =>
    v == null ? null : Number(v);
  const frac = (up: number, total: number): number | null => (total > 0 ? up / total : null);

  for (const id of monitorIds) {
    const c = countsBy.get(id);
    const t = timingBy.get(id);
    const downRow = downsBy.get(id);
    const allRow = allTimeBy.get(id);
    const total24 = Number(c?.total24 ?? 0);
    const total7 = Number(c?.total7 ?? 0);
    const total30 = Number(c?.total30 ?? 0);
    statsByMonitor.set(id, {
      uptime24h: frac(Number(c?.up24 ?? 0), total24),
      uptime7d: frac(Number(c?.up7 ?? 0), total7),
      uptime30d: frac(Number(c?.up30 ?? 0), total30),
      checks24h: total24,
      avgMs24h: num(t?.avg24),
      minMs24h: num(t?.min24),
      maxMs24h: num(t?.max24),
      avgMs7d: num(t?.avg7),
      lastDownAt: downRow ? toIso(downRow.lastDown) : null,
      firstCheckAt: allRow ? toIso(allRow.firstCheck) : null,
      totalChecks: allRow ? Number(allRow.total) : null,
    });
  }

  for (const row of recentRows) {
    const list = recentByMonitor.get(row.monitorId) ?? [];
    list.push(toCheckDTO(row));
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
  const recentChecks = recent ?? [];
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
    degraded: isDegraded({
      lastStatus: monitor.lastStatus,
      slowThresholdMs: monitor.slowThresholdMs ?? null,
      recentChecks,
    }),
    createdAt: monitor.createdAt.toISOString(),
    lastCheckAt: monitor.lastCheckAt?.toISOString() ?? null,
    lastStatus:
      monitor.lastStatus === "up" || monitor.lastStatus === "down" ? monitor.lastStatus : null,
    lastStatusCode: monitor.lastStatusCode ?? null,
    lastResponseMs: monitor.lastResponseMs ?? null,
    lastError: monitor.lastError ?? null,
    stats: stats ?? emptyStats(),
    recentChecks,
  };
}

/** p95 response time over the last 24h (real values, up checks only). Two
 *  bounded queries (count + ordered OFFSET) instead of loading and sorting
 *  every up check in JS — at a 1-minute interval that was ~1440 rows per
 *  detail-sheet load. */
export async function p95For(monitorId: string): Promise<number | null> {
  const since = new Date(Date.now() - H24);
  const where = { monitorId, status: "up", responseMs: { not: null }, checkedAt: { gte: since } };
  const n = await db.check.count({ where });
  if (n === 0) return null;
  // Index ceil(0.95 * n) - 1 into the ascending list, clamped to the last row.
  const offset = Math.min(n - 1, Math.ceil(0.95 * n) - 1);
  const row = await db.check.findFirst({
    where,
    orderBy: { responseMs: "asc" },
    skip: offset,
    select: { responseMs: true },
  });
  return row?.responseMs ?? null;
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
