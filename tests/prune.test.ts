// pruneChecks permanently deletes check history per the retention policy and
// the per-monitor 1000-check cap. An off-by-one here destroys data the user
// expected to keep, so each policy is pinned by a worked example.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";
import { MAX_CHECKS_PER_MONITOR } from "@/lib/checker";

async function setRetention(days: number | null) {
  await db.settings.create({
    data: { id: "main", passwordHash: "h", passwordSalt: "s", retentionDays: days },
  });
}

beforeEach(async () => {
  await resetDb();
});

test("the default policy caps a monitor at the newest 1000 checks", async () => {
  const { pruneChecks } = await import("@/lib/checker");
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  const base = Date.now();
  await db.check.createMany({
    data: Array.from({ length: MAX_CHECKS_PER_MONITOR + 5 }, (_, i) => ({
      monitorId: m.id,
      status: "up",
      // i=0 is the oldest; higher i is newer.
      checkedAt: new Date(base - (MAX_CHECKS_PER_MONITOR + 5 - i) * 60_000),
    })),
  });
  await setRetention(null); // default policy: 30 days + per-monitor cap

  const { deleted } = await pruneChecks();

  expect(deleted).toBe(5);
  expect(await db.check.count({ where: { monitorId: m.id } })).toBe(MAX_CHECKS_PER_MONITOR);
});

test("an explicit N-day policy deletes only checks older than N days", async () => {
  const { pruneChecks } = await import("@/lib/checker");
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  const now = Date.now();
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", checkedAt: new Date(now - 40 * 86400_000) }, // too old
      { monitorId: m.id, status: "up", checkedAt: new Date(now - 5 * 86400_000) }, // kept
      { monitorId: m.id, status: "up", checkedAt: new Date(now - 60_000) }, // kept
    ],
  });
  await setRetention(30);

  const { deleted } = await pruneChecks();

  expect(deleted).toBe(1);
  expect(await db.check.count({ where: { monitorId: m.id } })).toBe(2);
});

test("keep-forever (0) deletes no checks at all", async () => {
  const { pruneChecks } = await import("@/lib/checker");
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", checkedAt: new Date(Date.now() - 400 * 86400_000) },
      { monitorId: m.id, status: "up", checkedAt: new Date() },
    ],
  });
  await setRetention(0);

  const { deleted } = await pruneChecks();

  expect(deleted).toBe(0);
  expect(await db.check.count({ where: { monitorId: m.id } })).toBe(2);
});

test("expired sessions are pruned regardless of the retention setting", async () => {
  const { pruneChecks } = await import("@/lib/checker");
  await db.session.create({
    data: { token: "expired", expiresAt: new Date(Date.now() - 1000) },
  });
  await db.session.create({
    data: { token: "live", expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await setRetention(0); // keep forever still cleans operational rows

  await pruneChecks();

  const tokens = (await db.session.findMany()).map((s) => s.token);
  expect(tokens).toEqual(["live"]);
});
