// GET /api/overview is the dashboard's one data source: every monitor with its
// real stats, plus the folders. It must be auth-guarded and must order pinned
// monitors first (then the manual order), because the card list renders in the
// order it receives.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";

beforeEach(async () => {
  await resetDb();
});

async function overview(cookie: string | null = `${SESSION_COOKIE}=sess`) {
  const { GET } = await import("@/app/api/overview/route");
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return GET(new NextRequest("http://localhost/api/overview", { headers }));
}

test("an unauthenticated request is refused", async () => {
  expect((await overview(null)).status).toBe(401);
});

test("it returns folders and monitors, pinned first then by position", async () => {
  await db.session.create({ data: { token: "sess" } });
  const f = await db.folder.create({ data: { name: "Render Free" } });
  await db.monitor.create({ data: { name: "second", url: "https://b.com", position: 1, folderId: f.id } });
  await db.monitor.create({ data: { name: "pinned-last-pos", url: "https://c.com", position: 9, pinned: true } });
  await db.monitor.create({ data: { name: "first", url: "https://a.com", position: 0 } });

  const body = await (await overview()).json();
  expect(body.folders.map((x: { name: string }) => x.name)).toEqual(["Render Free"]);
  expect(body.monitors.map((m: { name: string }) => m.name)).toEqual([
    "pinned-last-pos", // pinned floats above the manual order
    "first",
    "second",
  ]);
  // The folder name is denormalised onto the monitor for the card.
  const second = body.monitors.find((m: { name: string }) => m.name === "second");
  expect(second.folderName).toBe("Render Free");
});

test("it carries each monitor's real stats", async () => {
  await db.session.create({ data: { token: "sess" } });
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.com" } });
  await db.check.createMany({
    data: [
      { monitorId: m.id, status: "up", responseMs: 100 },
      { monitorId: m.id, status: "down", statusCode: 503 },
    ],
  });

  const body = await (await overview()).json();
  const dto = body.monitors[0];
  expect(dto.stats.uptime24h).toBeCloseTo(0.5, 10);
  expect(dto.stats.checks24h).toBe(2);
  expect(dto.recentChecks).toHaveLength(2);
});
