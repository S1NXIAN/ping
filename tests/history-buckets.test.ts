// The history route bucket-averages a dense window (more checks than its
// point cap) into time buckets and flags the result `downsampled`. A wrong
// bucket boundary would silently misreport the response-time chart, so these
// tests drive the handler against a seeded dense window and assert the exact
// points, from worked examples rather than the implementation.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";

// A "1h" window over the route's 400-point cap is 9000 ms buckets. The cap is
// private to the route, so 401 checks is deliberately one past it — and every
// test asserts `downsampled`, so a raised cap fails loudly instead of the test
// silently drifting to raw points.
const RANGE = "1h";
const BUCKET_MS = 9000;
const DENSE = 401;

beforeEach(async () => {
  await resetDb();
});

/** A monitor and a valid session, plus a caller for its history route. */
async function setup() {
  const m = await db.monitor.create({
    data: { name: "svc", url: "https://svc.example.com", intervalSec: 60 },
  });
  await db.session.create({ data: { token: "sess" } });
  const { GET } = await import("@/app/api/monitors/[id]/history/route");
  const get = (id: string) =>
    GET(
      new NextRequest(`http://localhost/api/monitors/${id}/history?range=${RANGE}`, {
        headers: { cookie: `${SESSION_COOKIE}=sess` },
      }),
      { params: Promise.resolve({ id }) },
    );
  return { monitorId: m.id, get };
}

/** `count` up checks, all at `at`, each reporting `responseMs`. */
function upChecks(monitorId: string, at: Date, count: number, responseMs = 100) {
  return Array.from({ length: count }, () => ({
    monitorId,
    status: "up",
    responseMs,
    checkedAt: at,
  }));
}

test("a check exactly at the bucket edge starts the next bucket", async () => {
  const { monitorId, get } = await setup();
  const base = new Date(Date.now() - 600_000);
  const edge = new Date(base.getTime() + BUCKET_MS);
  await db.check.createMany({
    data: [...upChecks(monitorId, base, DENSE - 1), { monitorId, status: "up", responseMs: 200, checkedAt: edge }],
  });

  const body = await (await get(monitorId)).json();
  expect(body.downsampled).toBe(true);
  expect(body.points).toEqual([
    { t: base.getTime(), ms: 100, s: "up" },
    { t: edge.getTime(), ms: 200, s: "up" },
  ]);
});

test("an empty bucket is skipped, never fabricated", async () => {
  const { monitorId, get } = await setup();
  const base = new Date(Date.now() - 600_000);
  // Two whole buckets (base+9000, base+18000) hold no checks.
  const later = new Date(base.getTime() + 3 * BUCKET_MS);
  await db.check.createMany({
    data: [...upChecks(monitorId, base, DENSE - 1), { monitorId, status: "up", responseMs: 300, checkedAt: later }],
  });

  const body = await (await get(monitorId)).json();
  expect(body.points).toEqual([
    { t: base.getTime(), ms: 100, s: "up" },
    { t: later.getTime(), ms: 300, s: "up" },
  ]);
});

test("a bucket holding a failed check is reported as down", async () => {
  const { monitorId, get } = await setup();
  const base = new Date(Date.now() - 600_000);
  await db.check.createMany({
    data: [
      ...upChecks(monitorId, base, DENSE - 1),
      { monitorId, status: "down", statusCode: 503, checkedAt: new Date(base.getTime() + 1) },
    ],
  });

  const body = await (await get(monitorId)).json();
  // The bucket averages only its up checks, but the point is flagged down.
  expect(body.points).toEqual([{ t: base.getTime(), ms: 100, s: "down" }]);
});
