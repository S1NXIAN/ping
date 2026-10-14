// The create route checks the monitor cap and inserts in one transaction so two
// concurrent requests cannot both take the last slot. That transaction must
// actually succeed under concurrency: SQLite has one writer, and a default
// multi-connection pool lets the siblings contend until Prisma's transaction
// timeout kills them (P2028/P1008) — a real "New monitor" click 500s whenever
// the scheduler is writing at the same moment.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";
import { MAX_MONITORS } from "@/lib/checker";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(async () => {
  await resetDb();
  globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
});

async function createReq(url: string): Promise<NextRequest> {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  return new NextRequest("http://localhost/api/monitors", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=sess` },
    body: JSON.stringify({ url }),
  });
}

test("five simultaneous creates below the cap all succeed", async () => {
  const { POST } = await import("@/app/api/monitors/route");
  const reqs = await Promise.all(
    Array.from({ length: 5 }, (_, i) => createReq(`https://new-${i}.example.com`)),
  );
  const res = await Promise.all(reqs.map((r) => POST(r)));

  expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
  expect(await db.monitor.count()).toBe(5);
});

test("simultaneous creates at the cap boundary admit exactly the free slots", async () => {
  // Two slots left, five requests: exactly two land, the rest are refused.
  await db.monitor.createMany({
    data: Array.from({ length: MAX_MONITORS - 2 }, (_, i) => ({
      name: `m${i}`,
      url: `https://m${i}.example.com`,
    })),
  });
  const { POST } = await import("@/app/api/monitors/route");
  const reqs = await Promise.all(
    Array.from({ length: 5 }, (_, i) => createReq(`https://boundary-${i}.example.com`)),
  );
  const statuses = (await Promise.all(reqs.map((r) => POST(r))))
    .map((r) => r.status)
    .sort((a, b) => a - b);

  expect(statuses).toEqual([201, 201, 400, 400, 400]);
  expect(await db.monitor.count()).toBe(MAX_MONITORS);
});
