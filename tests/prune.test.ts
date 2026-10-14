// pruneChecks permanently deletes check history per the retention policy and
// the per-monitor 1000-check cap. An off-by-one here destroys data the user
// expected to keep, so each policy is pinned by a worked example.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";
import { MAX_CHECKS_PER_MONITOR } from "@/lib/retention";

async function setRetention(days: number | null) {
  await db.settings.create({
    data: { id: "main", passwordHash: "h", passwordSalt: "s", retentionDays: days },
  });
}

beforeEach(async () => {
  await resetDb();
});

test("the default policy caps a monitor at the newest 1000 checks", async () => {
  const { pruneChecks } = await import("@/lib/retention");
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
  const { pruneChecks } = await import("@/lib/retention");
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
  const { pruneChecks } = await import("@/lib/retention");
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

// Incident postmortem notes are keyed to a derived incident's exact start, and
// a derived incident never reaches further back than the lookback window — so a
// note older than the lookback can never match again and is pruned. This is a
// different clock from the retention setting: it must hold even when history is
// kept forever.
test("a note past the incident lookback is pruned; a note inside it is kept", async () => {
  const { pruneChecks } = await import("@/lib/retention");
  const { INCIDENT_LOOKBACK_DAYS } = await import("@/lib/incidents");
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  const now = Date.now();
  const days = (d: number) => new Date(now - d * 86400_000);
  // One day either side of the lookback boundary.
  await db.incidentNote.createMany({
    data: [
      { monitorId: m.id, startedAt: days(INCIDENT_LOOKBACK_DAYS + 1), note: "too old" },
      { monitorId: m.id, startedAt: days(INCIDENT_LOOKBACK_DAYS - 1), note: "still in range" },
    ],
  });
  await setRetention(0); // keep check history forever — notes are pruned anyway

  await pruneChecks();

  const left = await db.incidentNote.findMany({ select: { note: true } });
  expect(left.map((n) => n.note)).toEqual(["still in range"]);
});
