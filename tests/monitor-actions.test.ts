// Route-level invariants for manual "Check now" (POST /api/monitors/[id]/check)
// and monitor deletion (DELETE /api/monitors/[id]): auth guard, 404 on unknown
// ids, 409 when a check is already in flight, and recording selfMonitorDisabled
// when the deleted row is the Self-monitor.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { SESSION_COOKIE } from "@/lib/ping-auth";

const realFetch = globalThis.fetch;

beforeEach(async () => {
  await resetDb();
  globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function authed(path: string, method: string): Promise<NextRequest> {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: `${SESSION_COOKIE}=sess` },
  });
}

// ---- POST /api/monitors/[id]/check ----

test("check-now refuses unauthenticated callers and unknown monitors", async () => {
  const { POST } = await import("@/app/api/monitors/[id]/check/route");

  const unauth = await POST(
    new NextRequest("http://localhost/api/monitors/missing/check", { method: "POST" }),
    { params: Promise.resolve({ id: "missing" }) },
  );
  expect(unauth.status).toBe(401);

  const missing = await POST(await authed("/api/monitors/missing/check", "POST"), {
    params: Promise.resolve({ id: "missing" }),
  });
  expect(missing.status).toBe(404);
});

test("check-now runs one real check and refuses overlapping runs with 409", async () => {
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  const { POST } = await import("@/app/api/monitors/[id]/check/route");

  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  globalThis.fetch = mock(
    () =>
      new Promise<Response>((resolve) => {
        entered();
        release = () => resolve(new Response(null, { status: 200 }));
      }),
  ) as unknown as typeof fetch;

  const first = POST(await authed(`/api/monitors/${m.id}/check`, "POST"), {
    params: Promise.resolve({ id: m.id }),
  });
  await started;

  const overlap = await POST(await authed(`/api/monitors/${m.id}/check`, "POST"), {
    params: Promise.resolve({ id: m.id }),
  });
  expect(overlap.status).toBe(409);

  release();
  const res = await first;
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.check.status).toBe("up");
  expect(body.check.statusCode).toBe(200);
});

// ---- DELETE /api/monitors/[id] ----

test("delete refuses unauthenticated callers and unknown monitors", async () => {
  const { DELETE } = await import("@/app/api/monitors/[id]/route");

  const unauth = await DELETE(
    new NextRequest("http://localhost/api/monitors/missing", { method: "DELETE" }),
    { params: Promise.resolve({ id: "missing" }) },
  );
  expect(unauth.status).toBe(401);

  const missing = await DELETE(await authed("/api/monitors/missing", "DELETE"), {
    params: Promise.resolve({ id: "missing" }),
  });
  expect(missing.status).toBe(404);
});

test("deleting an ordinary monitor removes it and leaves selfMonitorDisabled false", async () => {
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s" } });
  const m = await db.monitor.create({ data: { name: "svc", url: "https://svc.example.com" } });
  await db.check.create({ data: { monitorId: m.id, status: "up", statusCode: 200 } });

  const { DELETE } = await import("@/app/api/monitors/[id]/route");
  const res = await DELETE(await authed(`/api/monitors/${m.id}`, "DELETE"), {
    params: Promise.resolve({ id: m.id }),
  });

  expect(res.status).toBe(200);
  expect(await db.monitor.findUnique({ where: { id: m.id } })).toBeNull();
  expect(await db.check.count({ where: { monitorId: m.id } })).toBe(0);
  const settings = await db.settings.findUniqueOrThrow({ where: { id: "main" } });
  expect(settings.selfMonitorDisabled).toBe(false);
});

test("deleting the Self-monitor disables future Self-monitor recreation", async () => {
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s" } });
  const self = await db.monitor.create({
    data: { name: "PING", url: "http://localhost/api/health", isSelfMonitor: true },
  });

  const { DELETE } = await import("@/app/api/monitors/[id]/route");
  const res = await DELETE(await authed(`/api/monitors/${self.id}`, "DELETE"), {
    params: Promise.resolve({ id: self.id }),
  });

  expect(res.status).toBe(200);
  expect(await db.monitor.findUnique({ where: { id: self.id } })).toBeNull();
  const settings = await db.settings.findUniqueOrThrow({ where: { id: "main" } });
  expect(settings.selfMonitorDisabled).toBe(true);
});
