// The monitor cap keeps tick duration and DB size honest on the free tier.
// POST /api/monitors used to count, then create, in two separate statements —
// so two requests that both read one-below-the-cap could both create, pushing
// the fleet past MAX_MONITORS. The count and the create must be one atomic
// step (the import route already does this with a transaction).
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";
import { MAX_MONITORS } from "@/lib/checker";

// Creating a monitor fires a first real check in the background; stub fetch so
// the test never reaches the network.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(async () => {
  await resetDb();
  globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
});

/** A create request for one URL. */
async function createReq(url: string): Promise<NextRequest> {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  return new NextRequest("http://localhost/api/monitors", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=sess` },
    body: JSON.stringify({ url }),
  });
}

test("two concurrent creates at the cap boundary cannot both pass", async () => {
  await db.monitor.createMany({
    data: Array.from({ length: MAX_MONITORS - 1 }, (_, i) => ({
      name: `m${i}`,
      url: `https://m${i}.example.com`,
    })),
  });

  const { POST } = await import("@/app/api/monitors/route");
  const [a, b] = await Promise.all([
    POST(await createReq("https://new-a.example.com")),
    POST(await createReq("https://new-b.example.com")),
  ]);

  // Exactly one wins the last slot; the other is refused at the cap. The
  // assertion is sorted, so it holds whichever request commits first.
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  expect(statuses).toEqual([201, 400]);
  expect(await db.monitor.count()).toBe(MAX_MONITORS);
});

test("a create below the cap still succeeds", async () => {
  const { POST } = await import("@/app/api/monitors/route");
  const res = await POST(await createReq("https://only.example.com"));
  expect(res.status).toBe(201);
  expect(await db.monitor.count()).toBe(1);
});
