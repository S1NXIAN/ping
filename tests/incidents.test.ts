// deriveIncidents stitches real down checks into incidents. Expected values
// come from worked examples, not the implementation.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

beforeEach(async () => {
  await resetDb();
});

test("a run of down checks becomes one incident, closed by the next up", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  const t = (min: number) => new Date(Date.now() - min * 60_000);
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", checkedAt: t(10) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: t(9) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: t(8) },
      { monitorId: m.id, status: "up", checkedAt: t(7) },
    ],
  });

  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(1);
  expect(incidents[0].downChecks).toBe(2);
  expect(incidents[0].lastStatusCode).toBe(503);
  expect(incidents[0].endedAt).not.toBeNull();
});

test("an up check in the middle splits two incidents", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  const t = (min: number) => new Date(Date.now() - min * 60_000);
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 500, checkedAt: t(9) },
      { monitorId: m.id, status: "up", checkedAt: t(8) },
      { monitorId: m.id, status: "down", statusCode: 502, checkedAt: t(7) },
    ],
  });
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(2);
});

test("an ongoing down run has endedAt null", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  await db.check.create({
    data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date() },
  });
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(1);
  expect(incidents[0].endedAt).toBeNull();
});

test("the batched query keeps each monitor's incidents separate", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const a = await db.monitor.create({ data: { name: "a", url: "https://a.com", intervalSec: 60 } });
  const b = await db.monitor.create({ data: { name: "b", url: "https://b.com", intervalSec: 60 } });
  const t = (min: number) => new Date(Date.now() - min * 60_000);
  await db.check.createMany({
    data: [
      // a: one incident, closed
      { monitorId: a.id, status: "down", statusCode: 500, checkedAt: t(9) },
      { monitorId: a.id, status: "up", checkedAt: t(8) },
      // b: two separate incidents
      { monitorId: b.id, status: "down", statusCode: 502, checkedAt: t(7) },
      { monitorId: b.id, status: "up", checkedAt: t(6) },
      { monitorId: b.id, status: "down", statusCode: 503, checkedAt: t(5) },
    ],
  });
  const incidents = await deriveIncidents([a, b]);
  expect(incidents.filter((i) => i.monitorId === a.id).length).toBe(1);
  expect(incidents.filter((i) => i.monitorId === b.id).length).toBe(2);
  const bLast = incidents.find((i) => i.monitorId === b.id && i.lastStatusCode === 503);
  expect(bLast?.endedAt).toBeNull(); // still ongoing
});

// ---- pinning ongoing incidents (#11) ----

/** One monitor with `n` closed incidents, each 2 checks, plus optionally one
 *  ongoing incident. Closed incidents are spaced 1 hour apart, newest last. */
async function seedIncidents(
  n: number,
  opts: { ongoing?: boolean } = {},
): Promise<{ id: string; name: string; intervalSec: number }> {
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  const now = Date.now();
  const rows: { monitorId: string; status: string; statusCode: number | null; checkedAt: Date }[] = [];
  // Oldest first: each closed incident is a down,up pair an hour apart.
  for (let i = 0; i < n; i++) {
    const base = now - (n - i + 1) * 3_600_000;
    rows.push({ monitorId: m.id, status: "down", statusCode: 500, checkedAt: new Date(base) });
    rows.push({ monitorId: m.id, status: "up", statusCode: 200, checkedAt: new Date(base + 60_000) });
  }
  if (opts.ongoing) {
    // An ongoing down run: the newest check is a down with nothing after it.
    rows.push({ monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now - 30_000) });
  }
  await db.check.createMany({ data: rows });
  return m;
}

test("an ongoing incident survives when more than the cap of newer incidents exist", async () => {
  const { deriveIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  // MAX_INCIDENTS + 5 closed incidents, plus the ongoing one.
  const m = await seedIncidents(MAX_INCIDENTS + 5, { ongoing: true });
  const incidents = await deriveIncidents([m]);
  const ongoing = incidents.filter((i) => i.endedAt == null);
  expect(ongoing.length).toBe(1);
});

test("the ongoing incident sorts above the closed ones", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await seedIncidents(3, { ongoing: true });
  const incidents = await deriveIncidents([m]);
  expect(incidents[0].endedAt).toBeNull();
});

test("closed incidents are capped", async () => {
  const { deriveIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  const m = await seedIncidents(MAX_INCIDENTS + 5);
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(MAX_INCIDENTS);
  for (const i of incidents) expect(i.endedAt).not.toBeNull();
});

test("closed incidents keep newest-first order", async () => {
  const { deriveIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  const m = await seedIncidents(MAX_INCIDENTS + 5);
  const incidents = await deriveIncidents([m]);
  for (let i = 1; i < incidents.length; i++) {
    expect(new Date(incidents[i - 1].startedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(incidents[i].startedAt).getTime(),
    );
  }
});

test("multiple ongoing incidents are ordered newest-first among themselves", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const older = await db.monitor.create({
    data: { name: "older", url: "https://older.example.com", intervalSec: 60 },
  });
  const newer = await db.monitor.create({
    data: { name: "newer", url: "https://newer.example.com", intervalSec: 60 },
  });
  await db.check.create({
    data: { monitorId: older.id, status: "down", checkedAt: new Date(Date.now() - 10 * 60_000) },
  });
  await db.check.create({
    data: { monitorId: newer.id, status: "down", checkedAt: new Date(Date.now() - 60_000) },
  });
  const incidents = await deriveIncidents([older, newer]);
  expect(incidents.map((i) => i.monitorName)).toEqual(["newer", "older"]);
});

test("every ongoing outage is listed — six monitors down, six incidents", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  // The reported bug: more monitors down at once than the old fixed cap of 5,
  // so the oldest ongoing outage vanished from the list.
  const monitors: Awaited<ReturnType<typeof db.monitor.create>>[] = [];
  for (let i = 0; i < 6; i++) {
    const m = await db.monitor.create({
      data: { name: `svc${i}`, url: `https://svc${i}.example.com`, intervalSec: 60 },
    });
    await db.check.create({
      data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date() },
    });
    monitors.push(m);
  }
  const incidents = await deriveIncidents(monitors);
  const ongoing = incidents.filter((i) => i.endedAt == null);
  expect(ongoing.length).toBe(6);
  expect(new Set(ongoing.map((i) => i.monitorId)).size).toBe(6);
});

test("the exempt ongoing set is bounded by the fleet cap, not a small fixed number", async () => {
  const { MAX_ONGOING_INCIDENTS } = await import("@/lib/incidents");
  const { MAX_MONITORS } = await import("@/lib/checker");
  // One ongoing incident per monitor, so the set is bounded by the fleet cap.
  // A cap below that would hide a real current outage — the bug this guards.
  expect(MAX_ONGOING_INCIDENTS).toBe(MAX_MONITORS);
});

test("a sleep gap between two down checks never fabricates one long incident", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 300 },
  });
  const now = Date.now();
  // One down, then PING asleep for 2h (far past 3x the 5-min interval), then
  // another down. The service was still failing, but PING observed nothing in
  // between — so the two must not be stitched into one two-hour outage.
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now - 2 * 3_600_000) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now) },
    ],
  });
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(2);
  // The older incident ends at its OWN last down check (zero-length here), not
  // at the later down across the gap.
  const older = incidents.find((i) => i.endedAt != null)!;
  expect(new Date(older.endedAt!).getTime()).toBe(new Date(older.startedAt).getTime());
  // The newer down, with nothing after it, is the ongoing one.
  const ongoing = incidents.filter((i) => i.endedAt == null);
  expect(ongoing.length).toBe(1);
});

test("a recovery observed after a sleep still closes the incident at the up check", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 300 },
  });
  const now = Date.now();
  // Down, PING asleep, then an UP two hours later. We DID observe the service
  // come back, so the incident ends at that real recovery time — not at the
  // last down (which would hide the recovery), and not at some invented middle.
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now - 2 * 3_600_000) },
      { monitorId: m.id, status: "up", statusCode: 200, checkedAt: new Date(now) },
    ],
  });
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(1);
  expect(incidents[0].endedAt).not.toBeNull();
  expect(new Date(incidents[0].endedAt!).getTime()).toBe(now);
});
