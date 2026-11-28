// Incidents carry their four-value state directly from the server module, so
// the early-stop cutoff that bounds the closed-incident query must use it too.
// Expected values come from worked examples, not the implementation.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

const H = 3_600_000;

beforeEach(async () => {
  await resetDb();
});

/** One monitor with `n` closed incidents (down then up), newest at `newestAt`
 *  and each older one `stepMs` before it. Returns the monitor. */
async function seedClosed(name: string, n: number, stepMs: number, newestAt: number) {
  const m = await db.monitor.create({
    data: { name, url: `https://${name}.example.com`, intervalSec: 60 },
  });
  const rows: { monitorId: string; status: string; statusCode: number; checkedAt: Date }[] = [];
  for (let i = 0; i < n; i++) {
    const t = newestAt - i * stepMs;
    rows.push({ monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(t) });
    rows.push({ monitorId: m.id, status: "up", statusCode: 200, checkedAt: new Date(t + 1000) });
  }
  await db.check.createMany({ data: rows });
  return m;
}

test("a paused open incident still lets a newer settled incident into the cut", async () => {
  const { listIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  const now = Date.now();

  // A paused monitor with a long open run: its row is settled (state "paused")
  // but has no endedAt. The early-stop cutoff must count it as settled, or it
  // can stop resolving before the newest resolved incident is reached.
  const paused = await db.monitor.create({
    data: { name: "paused", url: "https://paused.example.com", intervalSec: 600, enabled: false },
  });
  await db.check.create({
    data: {
      monitorId: paused.id,
      status: "down",
      statusCode: 503,
      checkedAt: new Date(now - 100 * H),
    },
  });

  // MAX_INCIDENTS older, resolved history on another monitor.
  await seedClosed("old", MAX_INCIDENTS, H, now - 200 * H);

  // One newer incident, resolved 1 hour ago. It must make the list.
  const fresh = await db.monitor.create({
    data: { name: "fresh", url: "https://fresh.example.com", intervalSec: 60 },
  });
  await db.check.createMany({
    data: [
      { monitorId: fresh.id, status: "down", statusCode: 503, checkedAt: new Date(now - H) },
      { monitorId: fresh.id, status: "up", statusCode: 200, checkedAt: new Date(now - H + 1000) },
    ],
  });

  const incidents = await listIncidents({ now });

  expect(incidents.some((i) => i.monitorId === fresh.id)).toBe(true);
  expect(incidents.filter((i) => i.state === "ongoing").length).toBe(0);
  // The paused row and the fresh one take two of the settled slots.
  expect(incidents.length).toBe(MAX_INCIDENTS);
  expect(incidents.map((i) => i.monitorId)).toContain(paused.id);
});

test("the four incident states come straight from the server module", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const now = Date.now();
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });

  // Ongoing: latest check is a down with nothing after it.
  await db.check.create({
    data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now - 60_000) },
  });
  let incidents = await listIncidents({ now });
  expect(incidents[0].state).toBe("ongoing");
  expect(incidents[0].endedAt).toBeNull();

  // Resolved: an up observed after the run closes it.
  await db.check.create({
    data: { monitorId: m.id, status: "up", statusCode: 200, checkedAt: new Date(now - 30_000) },
  });
  incidents = await listIncidents({ now });
  expect(incidents[0].state).toBe("resolved");
  expect(incidents[0].endedAt).not.toBeNull();

  // Paused: the monitor is disabled, so its open run has no check left to close it.
  const paused = await db.monitor.create({
    data: { name: "paused", url: "https://paused.example.com", intervalSec: 60, enabled: false },
  });
  await db.check.create({
    data: { monitorId: paused.id, status: "down", statusCode: 503, checkedAt: new Date(now - 60_000) },
  });
  incidents = await listIncidents({ now });
  expect(incidents.find((i) => i.monitorId === paused.id)?.state).toBe("paused");
  expect(incidents.find((i) => i.monitorId === paused.id)?.endedAt).toBeNull();
});

test("a sleep gap with no observed up check is no recovery", async () => {
  const { listIncidents } = await import("@/lib/incidents");
  const now = Date.now();
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 300 },
  });
  // Down, PING asleep 2h (past 3x the 5-min interval), down again.
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now - 2 * H) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now) },
    ],
  });

  const incidents = await listIncidents({ now });
  const older = incidents.find((i) => i.state === "no-recovery");
  expect(older).toBeDefined();
  expect(older?.endedAt).toBe(older?.startedAt);
  expect(incidents.some((i) => i.state === "ongoing")).toBe(true);
});
