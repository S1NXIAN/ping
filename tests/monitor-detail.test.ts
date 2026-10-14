// GET /api/monitors/[id] and GET /api/overview must agree on a monitor's
// stats. They used to compute them twice, by hand, in two files — so the card
// and the detail sheet could drift. This pins the one-source rule: the detail
// route's stats and recent-checks window are exactly collectMonitorStats's for
// that monitor. Expected values are a worked example, independent of either.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";

beforeEach(async () => {
  await resetDb();
});

async function detail(monitorId: string) {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  const { GET } = await import("@/app/api/monitors/[id]/route");
  const res = await GET(
    new NextRequest(`http://localhost/api/monitors/${monitorId}`, {
      headers: { cookie: `${SESSION_COOKIE}=sess` },
    }),
    { params: Promise.resolve({ id: monitorId }) },
  );
  return res.json();
}

test("the detail route reports the same stats collectMonitorStats computes", async () => {
  const { collectMonitorStats } = await import("@/lib/ping-stats");
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.com" } });
  const now = Date.now();
  await db.check.createMany({
    data: [
      // 3 up (100/200/300 ms) + 1 down, all within 24h -> uptime 0.75, avg 200.
      { monitorId: m.id, status: "up", responseMs: 100, checkedAt: new Date(now - 3000) },
      { monitorId: m.id, status: "up", responseMs: 200, checkedAt: new Date(now - 2000) },
      { monitorId: m.id, status: "up", responseMs: 300, checkedAt: new Date(now - 1000) },
      { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(now - 500) },
    ],
  });

  const bundle = await collectMonitorStats();
  const fromOverview = bundle.statsByMonitor.get(m.id)!;
  const body = await detail(m.id);

  expect(body.monitor.stats).toEqual(fromOverview);
  // The slow-state window is the same recent-checks window on both surfaces.
  expect(body.monitor.recentChecks.map((c: { id: string }) => c.id)).toEqual(
    bundle.recentByMonitor.get(m.id)!.map((c) => c.id),
  );
});
