// deriveIncidents only ever returns every ongoing incident plus the newest
// MAX_INCIDENTS closed ones. The derivation must therefore resolve only the
// streaks that can reach that output — not all ~40 per monitor — while
// producing exactly the same list. These tests pin the output on fleets that
// exercise that selection: recent non-last streaks winning the cut, the cap
// applied across monitors, ongoing incidents mixed in, and cross-monitor
// interleaving. Expected values are worked examples, not the implementation.
import { beforeEach, expect, test } from "bun:test";
import { db, resetDb } from "./helpers/test-db";

const H = 3_600_000;

beforeEach(async () => {
  await resetDb();
});

/** One monitor with `n` closed incidents (down then up), newest at `newestAt`
 *  and each older one `stepMs` before it. Returns the monitor and the incident
 *  start times, newest first. */
async function seedClosed(name: string, n: number, stepMs: number, newestAt: number) {
  const m = await db.monitor.create({
    data: { name, url: `https://${name}.example.com`, intervalSec: 60 },
  });
  const rows: { monitorId: string; status: string; statusCode: number; checkedAt: Date }[] = [];
  const starts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = newestAt - i * stepMs;
    starts.push(t);
    rows.push({ monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(t) });
    rows.push({ monitorId: m.id, status: "up", statusCode: 200, checkedAt: new Date(t + 1000) });
  }
  await db.check.createMany({ data: rows });
  return { monitor: m, starts };
}

/** One monitor with a single ongoing down run starting at `startedAt`. */
async function seedOngoing(name: string, startedAt: number) {
  const m = await db.monitor.create({
    data: { name, url: `https://${name}.example.com`, intervalSec: 60 },
  });
  await db.check.create({
    data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(startedAt) },
  });
  return m;
}

test("the newest closed incidents win across the whole fleet", async () => {
  const { deriveIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  const now = Date.now();
  // One flapping monitor with more incidents than the cap, all newer than a
  // second monitor's single old incident. The cap must keep the flapping
  // monitor's newest ones, not the old monitor's — and they come from its
  // OLDER (non-last) streaks, which the selection must still resolve.
  const blip = await seedClosed("blip", MAX_INCIDENTS + 5, H, now - H);
  const old = await seedClosed("old", 1, H, now - 500 * H);

  const incidents = await deriveIncidents([blip.monitor, old.monitor]);

  expect(incidents.length).toBe(MAX_INCIDENTS);
  expect(incidents.every((i) => i.monitorId === blip.monitor.id)).toBe(true);
  expect(incidents.map((i) => new Date(i.startedAt).getTime())).toEqual(
    blip.starts.slice(0, MAX_INCIDENTS),
  );
});

test("every ongoing incident is kept while closed ones are capped", async () => {
  const { deriveIncidents, MAX_INCIDENTS } = await import("@/lib/incidents");
  const now = Date.now();
  const blip = await seedClosed("blip", MAX_INCIDENTS + 5, H, now - H);
  const on1 = await seedOngoing("on1", now - 30_000);
  const on2 = await seedOngoing("on2", now - 60_000);

  const incidents = await deriveIncidents([blip.monitor, on1, on2]);

  expect(incidents.filter((i) => i.endedAt == null).length).toBe(2);
  expect(incidents.filter((i) => i.endedAt != null).length).toBe(MAX_INCIDENTS);
  // Ongoing pin to the top, newest first.
  expect(incidents[0].monitorId).toBe(on1.id);
  expect(incidents[1].monitorId).toBe(on2.id);
});

test("closed incidents from different monitors interleave by start time", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const now = Date.now();
  // A: now-1h, now-3h, now-5h. B: now-2h, now-4h.
  const a = await seedClosed("a", 1, 0, now - 1 * H);
  await db.check.createMany({
    data: [
      { monitorId: a.monitor.id, status: "down", statusCode: 503, checkedAt: new Date(now - 3 * H) },
      { monitorId: a.monitor.id, status: "up", statusCode: 200, checkedAt: new Date(now - 3 * H + 1000) },
      { monitorId: a.monitor.id, status: "down", statusCode: 503, checkedAt: new Date(now - 5 * H) },
      { monitorId: a.monitor.id, status: "up", statusCode: 200, checkedAt: new Date(now - 5 * H + 1000) },
    ],
  });
  const b = await db.monitor.create({
    data: { name: "b", url: "https://b.example.com", intervalSec: 60 },
  });
  await db.check.createMany({
    data: [
      { monitorId: b.id, status: "down", statusCode: 502, checkedAt: new Date(now - 2 * H) },
      { monitorId: b.id, status: "up", statusCode: 200, checkedAt: new Date(now - 2 * H + 1000) },
      { monitorId: b.id, status: "down", statusCode: 502, checkedAt: new Date(now - 4 * H) },
      { monitorId: b.id, status: "up", statusCode: 200, checkedAt: new Date(now - 4 * H + 1000) },
    ],
  });

  const incidents = await deriveIncidents([a.monitor, b]);

  expect(incidents.map((i) => new Date(i.startedAt).getTime())).toEqual([
    now - 1 * H,
    now - 2 * H,
    now - 3 * H,
    now - 4 * H,
    now - 5 * H,
  ]);
  expect(incidents.map((i) => i.monitorName)).toEqual(["a", "b", "a", "b", "a"]);
});

test("a monitor's older streak still contributes when it is among the newest", async () => {
  const { deriveIncidents } = await import("@/lib/incidents");
  const now = Date.now();
  // One monitor whose LAST streak is an ongoing outage, with an older CLOSED
  // streak before it. A selection that only ever resolves each monitor's final
  // streak would drop the closed one. It must still appear.
  const mixed = await db.monitor.create({
    data: { name: "mixed", url: "https://mixed.example.com", intervalSec: 60 },
  });
  await db.check.createMany({
    data: [
      { monitorId: mixed.id, status: "down", statusCode: 503, checkedAt: new Date(now - 6 * H) },
      { monitorId: mixed.id, status: "up", statusCode: 200, checkedAt: new Date(now - 6 * H + 1000) },
      { monitorId: mixed.id, status: "down", statusCode: 503, checkedAt: new Date(now - 60_000) },
    ],
  });
  const recent = await seedClosed("recent", 1, 0, now - 3 * H);

  const incidents = await deriveIncidents([mixed, recent.monitor]);

  // mixed: one closed (now-6h) + one ongoing. recent: one closed (now-3h).
  expect(incidents.length).toBe(3);
  expect(incidents.filter((i) => i.endedAt == null).length).toBe(1);
  const closedStarts = incidents
    .filter((i) => i.endedAt != null)
    .map((i) => new Date(i.startedAt).getTime())
    .sort((a, b) => a - b);
  expect(closedStarts).toEqual([now - 6 * H, now - 3 * H]);
});
