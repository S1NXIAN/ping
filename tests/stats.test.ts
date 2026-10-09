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

test("a monitor with no checks has null uptime, never an invented number", async () => {
  const { collectMonitorStats } = await import("@/lib/ping-stats");
  await db.monitor.create({ data: { name: "empty", url: "https://empty.com" } });
  const { statsByMonitor } = await collectMonitorStats();
  // No rows at all → the map has no entry (overview falls back to emptyStats).
  expect(statsByMonitor.size).toBe(0);
});
