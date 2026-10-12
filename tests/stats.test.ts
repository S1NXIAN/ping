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

  const { statsByMonitor } = await collectMonitorStats();
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
