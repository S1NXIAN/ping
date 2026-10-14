// collectMonitorStats aggregates real checks per monitor. Expected values are
// worked examples, independent of the implementation.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

beforeEach(async () => {
  await resetDb();
});

test("uptime and timing are computed per monitor from real checks", async () => {
  const { collectMonitorStats } = await import("@/lib/ping-stats");
  const a = await db.monitor.create({ data: { name: "a", url: "https://a.com" } });
  const b = await db.monitor.create({ data: { name: "b", url: "https://b.com" } });

  // a: 3 up (100/200/300 ms) + 1 down  -> uptime24h = 0.75, avg = 200
  await db.check.createMany({
    data: [
      { monitorId: a.id, status: "up", responseMs: 100 },
      { monitorId: a.id, status: "up", responseMs: 200 },
      { monitorId: a.id, status: "up", responseMs: 300 },
      { monitorId: a.id, status: "down", statusCode: 503 },
      // b: 2 up -> uptime24h = 1
      { monitorId: b.id, status: "up", responseMs: 50 },
      { monitorId: b.id, status: "up", responseMs: 70 },
    ],
  });

  const { statsByMonitor } = await collectMonitorStats(undefined, { includeAllTime: true });
  const sa = statsByMonitor.get(a.id)!;
  const sb = statsByMonitor.get(b.id)!;

  expect(sa.uptime24h).toBeCloseTo(0.75, 10);
  expect(sa.checks24h).toBe(4);
  expect(sa.avgMs24h).toBeCloseTo(200, 10);
  expect(sa.minMs24h).toBe(100);
  expect(sa.maxMs24h).toBe(300);
  expect(sa.totalChecks).toBe(4);

  expect(sb.uptime24h).toBe(1);
  expect(sb.checks24h).toBe(2);
  expect(sb.avgMs24h).toBeCloseTo(60, 10);
});

test("the recent-checks window caps at RECENT_CHECKS", async () => {
  const { collectMonitorStats, RECENT_CHECKS } = await import("@/lib/ping-stats");
  const m = await db.monitor.create({ data: { name: "busy", url: "https://busy.com" } });
  const base = Date.now();
  await db.check.createMany({
    data: Array.from({ length: RECENT_CHECKS + 3 }, (_, i) => ({
      monitorId: m.id,
      status: "up",
      responseMs: i,
      checkedAt: new Date(base - i * 60_000),
    })),
  });

  const { recentByMonitor } = await collectMonitorStats();
  expect(recentByMonitor.get(m.id)!).toHaveLength(RECENT_CHECKS);
});

test("the recent-checks window is newest first", async () => {
  const { collectMonitorStats } = await import("@/lib/ping-stats");
  const m = await db.monitor.create({ data: { name: "busy", url: "https://busy.com" } });
  const base = Date.now();
  await db.check.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      monitorId: m.id,
      status: "up",
      responseMs: i,
      checkedAt: new Date(base - i * 60_000),
    })),
  });

  const { recentByMonitor } = await collectMonitorStats();
  // responseMs 0 is the newest check (checkedAt = base), so it leads the window.
  expect(recentByMonitor.get(m.id)![0]!.responseMs).toBe(0);
});

test("a monitor with no checks has null uptime, never an invented number", async () => {
  const { collectMonitorStats } = await import("@/lib/ping-stats");
  await db.monitor.create({ data: { name: "empty", url: "https://empty.com" } });
  const { statsByMonitor } = await collectMonitorStats();
  // No rows at all → the map has no entry (overview falls back to emptyStats).
  expect(statsByMonitor.size).toBe(0);
});

// p95For must return the same value the JS computation did, now from one
// bounded query. The index is ceil(0.95 * n), clamped to n — pinned here with
// worked examples so a rewrite cannot silently shift the percentile.
test("p95For picks the ceil(0.95n)-th smallest up-check latency", async () => {
  const { p95For } = await import("@/lib/ping-stats");
  const m = await db.monitor.create({ data: { name: "p", url: "https://p.com" } });
  // 1..20 ms; ceil(0.95*20)=19 -> the 19th smallest = 19.
  await db.check.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      monitorId: m.id,
      status: "up",
      responseMs: i + 1,
      checkedAt: new Date(Date.now() - (i + 1) * 60_000),
    })),
  });
  expect(await p95For(m.id)).toBe(19);
});

test("p95For ignores down checks and checks outside the 24h window", async () => {
  const { p95For } = await import("@/lib/ping-stats");
  const m = await db.monitor.create({ data: { name: "p", url: "https://p.com" } });
  const now = Date.now();
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", responseMs: 10, checkedAt: new Date(now - 60_000) },
      { monitorId: m.id, status: "up", responseMs: 20, checkedAt: new Date(now - 120_000) },
      // A huge failed check and a huge old check must not move the number.
      { monitorId: m.id, status: "down", statusCode: 503, responseMs: 99999, checkedAt: new Date(now - 180_000) },
      { monitorId: m.id, status: "up", responseMs: 88888, checkedAt: new Date(now - 40 * 3600_000) },
    ],
  });
  // Two up checks in window: ceil(0.95*2)=2 -> the largest = 20.
  expect(await p95For(m.id)).toBe(20);
});

test("p95For is null with no up checks in the window", async () => {
  const { p95For } = await import("@/lib/ping-stats");
  const m = await db.monitor.create({ data: { name: "p", url: "https://p.com" } });
  expect(await p95For(m.id)).toBeNull();
});

test("the fleet pass can skip the all-time totals, which are unbounded", async () => {
  // The overview polls every 15s and never shows totalChecks/firstCheckAt;
  // only the detail sheet does. Under "keep forever" the all-time GROUP BY
  // scans the whole Check table, so the fleet pass opts out. Absent is null,
  // never a fabricated 0 (a monitor with 5000 checks is not "0 checks").
  const { collectMonitorStats } = await import("@/lib/ping-stats");
  const m = await db.monitor.create({ data: { name: "busy", url: "https://busy.com" } });
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", responseMs: 10 },
      { monitorId: m.id, status: "up", responseMs: 20 },
    ],
  });

  const { statsByMonitor } = await collectMonitorStats(undefined, { includeAllTime: false });
  const s = statsByMonitor.get(m.id)!;
  expect(s.totalChecks).toBeNull();
  expect(s.firstCheckAt).toBeNull();
  // The windowed numbers are unaffected — they are what the overview shows.
  expect(s.checks24h).toBe(2);
  expect(s.uptime24h).toBe(1);
});

test("the scoped (detail) pass still reports the all-time totals", async () => {
  const { collectMonitorStats } = await import("@/lib/ping-stats");
  const m = await db.monitor.create({ data: { name: "busy", url: "https://busy.com" } });
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", responseMs: 10, checkedAt: new Date(1000) },
      { monitorId: m.id, status: "up", responseMs: 20, checkedAt: new Date(2000) },
    ],
  });

  const { statsByMonitor } = await collectMonitorStats([m.id]);
  const s = statsByMonitor.get(m.id)!;
  expect(s.totalChecks).toBe(2);
  expect(s.firstCheckAt).toBe(new Date(1000).toISOString());
});

// The uptime/latency aggregates are computed with conditional aggregation in
// two scans instead of five windowed groupBys. The VALUES must not change —
// these pin the multi-window numbers (24h / 7d / 30d) from a worked example.
test("multi-window uptime and latency match the worked example", async () => {
  const { collectMonitorStats } = await import("@/lib/ping-stats");
  const m = await db.monitor.create({ data: { name: "w", url: "https://w.com" } });
  const now = Date.now();
  const days = (d: number) => new Date(now - d * 86400_000);
  await db.check.createMany({
    data: [
      // 24h window: 3 up (100/200/300) + 1 down -> uptime 0.75, avg 200
      { monitorId: m.id, status: "up", responseMs: 100, checkedAt: days(0.1) },
      { monitorId: m.id, status: "up", responseMs: 200, checkedAt: days(0.2) },
      { monitorId: m.id, status: "up", responseMs: 300, checkedAt: days(0.3) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: days(0.4) },
      // 7d-only window: 1 up (500) + 1 down -> 7d adds 2 checks, 1 up
      { monitorId: m.id, status: "up", responseMs: 500, checkedAt: days(3) },
      { monitorId: m.id, status: "down", statusCode: 500, checkedAt: days(4) },
      // 30d-only window: 1 up (900) -> 30d adds 1 check, 1 up
      { monitorId: m.id, status: "up", responseMs: 900, checkedAt: days(20) },
    ],
  });

  const { statsByMonitor } = await collectMonitorStats(undefined, { includeAllTime: true });
  const s = statsByMonitor.get(m.id)!;
  // 24h: 3/4 up
  expect(s.uptime24h).toBeCloseTo(0.75, 10);
  expect(s.checks24h).toBe(4);
  expect(s.avgMs24h).toBeCloseTo(200, 10);
  expect(s.minMs24h).toBe(100);
  expect(s.maxMs24h).toBe(300);
  // 7d: 4 up / 6 total
  expect(s.uptime7d).toBeCloseTo(4 / 6, 10);
  // 7d avg over the 4 up checks: (100+200+300+500)/4 = 275
  expect(s.avgMs7d).toBeCloseTo(275, 10);
  // 30d: 5 up / 7 total
  expect(s.uptime30d).toBeCloseTo(5 / 7, 10);
  expect(s.totalChecks).toBe(7);
});
