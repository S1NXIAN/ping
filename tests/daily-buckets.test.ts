// The public status page needs one day-bucket series per monitor. This must
// come from a single grouped query, not one query per monitor.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

beforeEach(async () => {
  await resetDb();
});

test("returns per-monitor daily up/down buckets in one grouped query", async () => {
  const { dailyBucketsByMonitor } = await import("@/lib/ping-stats");
  const a = await db.monitor.create({ data: { name: "a", url: "https://a.com" } });
  const b = await db.monitor.create({ data: { name: "b", url: "https://b.com" } });
  const today = new Date();

  await db.check.createMany({
    data: [
      { monitorId: a.id, status: "up", checkedAt: today },
      { monitorId: a.id, status: "up", checkedAt: today },
      { monitorId: a.id, status: "down", checkedAt: today },
      { monitorId: b.id, status: "up", checkedAt: today },
    ],
  });

  const map = await dailyBucketsByMonitor([a.id, b.id]);
  const key = today.toISOString().slice(0, 10);
  expect(map.get(a.id)).toEqual([{ date: key, up: 2, down: 1 }]);
  expect(map.get(b.id)).toEqual([{ date: key, up: 1, down: 0 }]);
  // A monitor with no checks simply has no entry.
  expect(map.get("nonexistent")).toBeUndefined();
});

test("no monitors → empty map, no query error", async () => {
  const { dailyBucketsByMonitor } = await import("@/lib/ping-stats");
  const map = await dailyBucketsByMonitor([]);
  expect(map.size).toBe(0);
});
