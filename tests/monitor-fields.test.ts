// The keyword and slow-threshold rules are enforced at every write boundary —
// create, edit and import — so a monitor that would misreport can't be stored.
// These rules used to be copy-pasted into all three routes; they now come from
// one place in lib/validation.ts. These tests pin the bounds and the clearing
// behaviour at the route seams, so the three boundaries can never drift apart.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";

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

async function authed(path: string, method: string, body: unknown): Promise<NextRequest> {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=sess` },
    body: JSON.stringify(body),
  });
}

async function create(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/monitors/route");
  return POST(await authed("/api/monitors", "POST", body));
}

async function patch(id: string, body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/monitors/[id]/route");
  return PATCH(await authed(`/api/monitors/${id}`, "PATCH", body), {
    params: Promise.resolve({ id }),
  });
}

async function importFile(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/import/route");
  return POST(await authed("/api/import", "POST", body));
}

// ---- slow threshold bounds (50–30000) ----

test("create accepts a slow threshold at each bound", async () => {
  expect((await create({ url: "https://a.com", slowThresholdMs: 50 })).status).toBe(201);
  expect((await create({ url: "https://b.com", slowThresholdMs: 30000 })).status).toBe(201);
});

test("create refuses a slow threshold below 50 ms", async () => {
  expect((await create({ url: "https://c.com", slowThresholdMs: 49 })).status).toBe(400);
});

test("create refuses a slow threshold above 30000 ms", async () => {
  expect((await create({ url: "https://d.com", slowThresholdMs: 30001 })).status).toBe(400);
});

test("patch accepts the slow-threshold bounds and rejects past them", async () => {
  const m = await db.monitor.create({ data: { name: "m", url: "https://m.com" } });
  expect((await patch(m.id, { slowThresholdMs: 50 })).status).toBe(200);
  expect((await patch(m.id, { slowThresholdMs: 49 })).status).toBe(400);
  expect((await patch(m.id, { slowThresholdMs: 30001 })).status).toBe(400);
  expect((await patch(m.id, { slowThresholdMs: null })).status).toBe(200); // off
});

test("import accepts a slow threshold at the lower bound", async () => {
  const ok = await importFile({
    app: "PING",
    version: 1,
    monitors: [{ name: "ok", url: "https://ok.com", slowThresholdMs: 50 }],
  });
  expect(ok.status).toBe(200);
});

test("import refuses a slow threshold below the lower bound", async () => {
  const bad = await importFile({
    app: "PING",
    version: 1,
    monitors: [{ name: "bad", url: "https://bad.com", slowThresholdMs: 49 }],
  });
  expect(bad.status).toBe(400);
});

// ---- keyword rules ----

test("a keyword longer than 200 characters is refused on create", async () => {
  expect((await create({ url: "https://a.com", keyword: "x".repeat(201) })).status).toBe(400);
});

test("a keyword longer than 200 characters is refused on patch", async () => {
  const m = await db.monitor.create({ data: { name: "m", url: "https://m.com" } });
  expect((await patch(m.id, { keyword: "x".repeat(201) })).status).toBe(400);
});

test("a keyword longer than 200 characters is refused on import", async () => {
  const imp = await importFile({
    app: "PING",
    version: 1,
    monitors: [{ name: "bad", url: "https://bad.com", keyword: "x".repeat(201) }],
  });
  expect(imp.status).toBe(400);
});

test("a HEAD monitor with a keyword is refused on create", async () => {
  expect((await create({ url: "https://a.com", method: "HEAD", keyword: "ok" })).status).toBe(400);
});

test("a HEAD monitor with a keyword is refused on patch", async () => {
  const m = await db.monitor.create({ data: { name: "m", url: "https://m.com" } });
  expect((await patch(m.id, { method: "HEAD", keyword: "ok" })).status).toBe(400);
});

test("a HEAD monitor with a keyword is refused on import", async () => {
  const imp = await importFile({
    app: "PING",
    version: 1,
    monitors: [{ name: "bad", url: "https://bad.com", method: "HEAD", keyword: "ok" }],
  });
  expect(imp.status).toBe(400);
});
