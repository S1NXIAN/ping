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

test("an ongoing incident is listed first, above newer closed incidents", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const m = await seedIncidents(3, { ongoing: true });
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBeGreaterThan(0);
  expect(incidents[0].endedAt).toBeNull();
});

test("an ongoing incident survives when more than the cap of newer incidents exist", async () => {
  const { deriveIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  // MAX_INCIDENTS + 5 closed incidents, plus the ongoing one.
  const m = await seedIncidents(MAX_INCIDENTS + 5, { ongoing: true });
  const incidents = await deriveIncidents([m]);
  const ongoing = incidents.filter((i) => i.endedAt == null);
  expect(ongoing.length).toBe(1);
  expect(incidents[0].endedAt).toBeNull();
});

test("closed incidents keep newest-first order and the cap bounds them", async () => {
  const { deriveIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  const m = await seedIncidents(MAX_INCIDENTS + 5);
  const incidents = await deriveIncidents([m]);
  expect(incidents.length).toBe(MAX_INCIDENTS);
  for (const i of incidents) expect(i.endedAt).not.toBeNull();
  // Newest first.
  for (let i = 1; i < incidents.length; i++) {
    expect(new Date(incidents[i - 1].startedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(incidents[i].startedAt).getTime(),
    );
  }
});

test("the exempt ongoing set is bounded", async () => {
  const { deriveIncidents, MAX_ONGOING_INCIDENTS } = await import("@/lib/incidents");
  // Ten monitors, each with its own ongoing incident.
  const monitors: Awaited<ReturnType<typeof db.monitor.create>>[] = [];
  for (let i = 0; i < MAX_ONGOING_INCIDENTS + 5; i++) {
    const m = await db.monitor.create({
      data: { name: `svc${i}`, url: `https://svc${i}.example.com`, intervalSec: 60 },
    });
    await db.check.create({
      data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date() },
    });
    monitors.push(m);
  }
  const incidents = await deriveIncidents(monitors);
  expect(incidents.filter((i) => i.endedAt == null).length).toBe(MAX_ONGOING_INCIDENTS);
});
