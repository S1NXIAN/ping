// listIncidents stitches real down checks into incidents. Expected values
// come from worked examples, not the implementation.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

beforeEach(async () => {
  await resetDb();
});

async function monitor(name = "svc", intervalSec = 60, enabled = true) {
  return db.monitor.create({
    data: { name, url: `https://${name}.example.com`, intervalSec, enabled },
  });
}

test("a run of down checks becomes one incident, closed by the next up", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const m = await monitor();
  const now = Date.now();
  const t = (min: number) => new Date(now - min * 60_000);
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", checkedAt: t(10) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: t(9) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: t(8) },
      { monitorId: m.id, status: "up", checkedAt: t(7) },
    ],
  });

  const incidents = await listIncidents({ now });
  expect(incidents.length).toBe(1);
  expect(incidents[0].state).toBe("resolved");
  expect(incidents[0].endedAt).not.toBeNull();
});

test("an up check in the middle splits two incidents", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const m = await monitor();
  const now = Date.now();
  const t = (min: number) => new Date(now - min * 60_000);
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 500, checkedAt: t(9) },
      { monitorId: m.id, status: "up", checkedAt: t(8) },
      { monitorId: m.id, status: "down", statusCode: 502, checkedAt: t(7) },
    ],
  });
  const incidents = await listIncidents({ now });
  expect(incidents.length).toBe(2);
});

test("an ongoing down run has endedAt null", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const m = await monitor();
  const now = Date.now();
  await db.check.create({
    data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now) },
  });
  const incidents = await listIncidents({ now });
  expect(incidents.length).toBe(1);
  expect(incidents[0].state).toBe("ongoing");
  expect(incidents[0].endedAt).toBeNull();
});

test("the batched query keeps each monitor's incidents separate", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const a = await monitor("a");
  const b = await monitor("b");
  const now = Date.now();
  const t = (min: number) => new Date(now - min * 60_000);
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
  const incidents = await listIncidents({ now });
  expect(incidents.filter((i) => i.monitorId === a.id).length).toBe(1);
  expect(incidents.filter((i) => i.monitorId === b.id).length).toBe(2);
  const bLast = incidents.find((i) => i.monitorId === b.id && i.endedAt === null);
  expect(bLast?.state).toBe("ongoing");
});

// ---- pinning ongoing incidents (#11) ----

/** One monitor with `n` closed incidents, each 2 checks, plus optionally one
 *  ongoing incident. Closed incidents are spaced 1 hour apart, newest last. */
async function seedIncidents(n: number, opts: { ongoing?: boolean } = {}) {
  const m = await monitor();
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
  return { m, now };
}

test("an ongoing incident survives when more than the cap of newer incidents exist", async () => {
  const { listIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  // MAX_INCIDENTS + 5 closed incidents, plus the ongoing one.
  const { m, now } = await seedIncidents(MAX_INCIDENTS + 5, { ongoing: true });
  const incidents = await listIncidents({ now });
  expect(incidents.filter((i) => i.monitorId === m.id && i.state === "ongoing").length).toBe(1);
});

test("the ongoing incident sorts above the closed ones", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const { now } = await seedIncidents(3, { ongoing: true });
  const incidents = await listIncidents({ now });
  expect(incidents[0].state).toBe("ongoing");
});

test("closed incidents are capped", async () => {
  const { listIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  const { now } = await seedIncidents(MAX_INCIDENTS + 5);
  const incidents = await listIncidents({ now });
  expect(incidents.length).toBe(MAX_INCIDENTS);
  for (const i of incidents) expect(i.state).not.toBe("ongoing");
});

test("closed incidents keep newest-first order", async () => {
  const { listIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  const { now } = await seedIncidents(MAX_INCIDENTS + 5);
  const incidents = await listIncidents({ now });
  for (let i = 1; i < incidents.length; i++) {
    expect(new Date(incidents[i - 1].startedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(incidents[i].startedAt).getTime(),
    );
  }
});

test("multiple ongoing incidents are ordered newest-first among themselves", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const older = await monitor("older");
  const newer = await monitor("newer");
  const now = Date.now();
  await db.check.create({
    data: { monitorId: older.id, status: "down", checkedAt: new Date(now - 10 * 60_000) },
  });
  await db.check.create({
    data: { monitorId: newer.id, status: "down", checkedAt: new Date(now - 60_000) },
  });
  const incidents = await listIncidents({ now });
  expect(incidents.map((i) => i.monitorName)).toEqual(["newer", "older"]);
});

test("every ongoing outage is listed — six monitors down, six incidents", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  // The reported bug: more monitors down at once than the old fixed cap of 5,
  // so the oldest ongoing outage vanished from the list.
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const m = await monitor(`svc${i}`);
    await db.check.create({
      data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now) },
    });
  }
  const incidents = await listIncidents({ now });
  const ongoing = incidents.filter((i) => i.state === "ongoing");
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
  const { listIncidents } = await import("@/lib/incidents");
  const m = await monitor("svc", 300);
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
  const incidents = await listIncidents({ now });
  expect(incidents.length).toBe(2);
  // The older incident ends at its OWN last down check (zero-length here), not
  // at the later down across the gap.
  const older = incidents.find((i) => i.state === "no-recovery")!;
  expect(new Date(older.endedAt!).getTime()).toBe(new Date(older.startedAt).getTime());
  // The newer down, with nothing after it, is the ongoing one.
  const ongoing = incidents.filter((i) => i.state === "ongoing");
  expect(ongoing.length).toBe(1);
});

test("a failed manual check while paused never opens an incident", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const m = await monitor("svc", 600, false);
  const now = Date.parse("2026-01-15T00:00:00Z");
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now - 3_600_000) },
      // Manual "Check now" after the monitor was paused; still failing.
      {
        monitorId: m.id,
        status: "down",
        statusCode: 503,
        whilePaused: true,
        checkedAt: new Date(now - 300_000),
      },
    ],
  });
  const incidents = await listIncidents({ now });
  // The pre-pause run stays the one paused incident; the manual failure adds none.
  expect(incidents.length).toBe(1);
  expect(incidents[0].state).toBe("paused");
  expect(incidents[0].endedAt).toBeNull();
  expect(new Date(incidents[0].startedAt).getTime()).toBe(now - 3_600_000);
});

test("a successful manual check while paused resolves the incident", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const m = await monitor("svc", 600, false);
  const now = Date.parse("2026-01-15T00:00:00Z");
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now - 3_600_000) },
      {
        monitorId: m.id,
        status: "up",
        statusCode: 200,
        whilePaused: true,
        checkedAt: new Date(now - 300_000),
      },
    ],
  });
  const incidents = await listIncidents({ now });
  expect(incidents.length).toBe(1);
  expect(incidents[0].state).toBe("resolved");
  expect(new Date(incidents[0].endedAt!).getTime()).toBe(now - 300_000);
});

test("a paused monitor's open incident is flagged paused, not dropped", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const m = await monitor();
  const now = Date.now();
  const t = (min: number) => new Date(now - min * 60_000);
  const openStart = t(5);
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: t(30) },
      { monitorId: m.id, status: "up", statusCode: 200, checkedAt: t(29) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: openStart },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: t(4) },
    ],
  });

  // Paused: no check will close the open run, so the row says paused.
  await db.monitor.update({ where: { id: m.id }, data: { enabled: false } });
  const paused = await listIncidents({ now });
  expect(paused.length).toBe(2);
  const open = paused.filter((i) => i.endedAt == null);
  expect(open.length).toBe(1);
  expect(open[0].state).toBe("paused");
  expect(open[0].startedAt).toBe(openStart.toISOString());

  // Resumed: the same open run is a real ongoing incident again.
  await db.monitor.update({ where: { id: m.id }, data: { enabled: true } });
  const resumed = await listIncidents({ now });
  expect(resumed.length).toBe(2);
  const stillOpen = resumed.filter((i) => i.endedAt == null);
  expect(stillOpen.length).toBe(1);
  expect(stillOpen[0].state).toBe("ongoing");
  expect(stillOpen[0].startedAt).toBe(openStart.toISOString());
});

test("a paused incident is not pinned above newer resolved history", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const paused = await monitor("paused", 600, false);
  const running = await monitor("running", 600);
  const now = Date.parse("2026-01-15T00:00:00Z");
  await db.check.createMany({
    data: [
      // Paused monitor: open run started two hours ago.
      { monitorId: paused.id, status: "down", statusCode: 503, checkedAt: new Date(now - 2 * 3_600_000) },
      // Running monitor: newer, already resolved.
      { monitorId: running.id, status: "down", statusCode: 503, checkedAt: new Date(now - 3_600_000) },
      { monitorId: running.id, status: "up", statusCode: 200, checkedAt: new Date(now - 30 * 60_000) },
    ],
  });
  const incidents = await listIncidents({ now });
  expect(incidents.map((i) => i.monitorName)).toEqual(["running", "paused"]);
});

test("a recovery observed after a sleep still closes the incident at the up check", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const m = await monitor("svc", 300);
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
  const incidents = await listIncidents({ now });
  expect(incidents.length).toBe(1);
  expect(incidents[0].state).toBe("resolved");
  expect(new Date(incidents[0].endedAt!).getTime()).toBe(now);
});
