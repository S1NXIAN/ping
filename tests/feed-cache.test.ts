// The RSS feed derives incidents from real checks on every request and had no
// server-side cache, unlike the status page (10s). A feed reader polling it
// paid the full derivation each time. It now shares the same TTL-cache idea:
// within the window the same body is served, so a burst of readers does one
// derivation, not N.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";

function feedReq(token: string): NextRequest {
  return new NextRequest(`http://localhost/api/public/feed?token=${token}`);
}

beforeEach(async () => {
  await resetDb();
});

test("the feed serves real incidents and caches the body within its window", async () => {
  const { GET } = await import("@/app/api/public/feed/route");
  await db.settings.create({
    data: { id: "main", passwordHash: "h", passwordSalt: "s", statusToken: TOKEN },
  });
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  await db.check.create({
    data: { monitorId: m.id, status: "down", statusCode: 503, checkedAt: new Date(Date.now() - 60_000) },
  });

  const first = await (await GET(feedReq(TOKEN))).text();
  expect(first).toContain("svc");

  // A second incident lands, but the cached body is still served (fresh within
  // the TTL — the same guarantee the status page gives).
  await db.check.create({
    data: { monitorId: m.id, status: "down", statusCode: 500, checkedAt: new Date() },
  });
  const second = await (await GET(feedReq(TOKEN))).text();
  expect(second).toBe(first);
});

test("a wrong token is still 404, uncached", async () => {
  const { GET } = await import("@/app/api/public/feed/route");
  await db.settings.create({
    data: { id: "main", passwordHash: "h", passwordSalt: "s", statusToken: TOKEN },
  });
  const res = await GET(feedReq("b".repeat(48)));
  expect(res.status).toBe(404);
});
