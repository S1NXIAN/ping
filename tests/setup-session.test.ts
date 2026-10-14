// POST /api/auth/setup creates the single admin password. It is the one route
// that runs before any auth exists, so its guards matter: a weak password is
// refused, a second setup is refused (otherwise anyone could reset the
// password), and a successful setup issues a session. The re-prompt window
// setting (GET/POST /api/admin/session) is admin-only and preset-constrained.
import { beforeEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import { getSettings, resetThrottle, SESSION_COOKIE, verifyPassword } from "@/lib/ping-auth";

beforeEach(async () => {
  await resetDb();
  resetThrottle(); // throttle state is process-global — never leak it across tests
});

function setupReq(password: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

test("setup stores a hashed password and issues a session", async () => {
  const { POST } = await import("@/app/api/auth/setup/route");
  const res = await POST(setupReq("a-good-password"));

  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain(SESSION_COOKIE);
  const settings = await getSettings();
  expect(settings).not.toBeNull();
  expect(verifyPassword("a-good-password", settings!.passwordHash, settings!.passwordSalt)).toBe(true);
  // The password is never stored in the clear.
  expect(settings!.passwordHash).not.toContain("a-good-password");
  expect(await db.session.count()).toBe(1);
});

test("a password shorter than 8 characters is refused", async () => {
  const { POST } = await import("@/app/api/auth/setup/route");
  const res = await POST(setupReq("short"));
  expect(res.status).toBe(400);
  expect(await getSettings()).toBeNull();
});

test("a second setup is refused — the existing password is never overwritten", async () => {
  const { POST } = await import("@/app/api/auth/setup/route");
  await POST(setupReq("first-password"));

  const res = await POST(setupReq("second-password"));
  expect(res.status).toBe(400);
  const settings = await getSettings();
  expect(verifyPassword("first-password", settings!.passwordHash, settings!.passwordSalt)).toBe(true);
  expect(verifyPassword("second-password", settings!.passwordHash, settings!.passwordSalt)).toBe(false);
});

// ---- /api/admin/session ----

async function sessionReq(method: string, body?: unknown): Promise<NextRequest> {
  await db.session.upsert({ where: { token: "sess" }, create: { token: "sess" }, update: {} });
  return new NextRequest("http://localhost/api/admin/session", {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=sess` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("GET reports the default window and the offered presets", async () => {
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s" } });
  const { GET } = await import("@/app/api/admin/session/route");
  const body = await (await GET(await sessionReq("GET"))).json();
  expect(body.sessionMinutes).toBe(15);
  expect(body.presets).toEqual([5, 15, 30, 60, 120]);
});

test("POST stores an offered duration", async () => {
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s" } });
  const { POST } = await import("@/app/api/admin/session/route");
  const res = await POST(await sessionReq("POST", { sessionMinutes: 60 }));
  expect(res.status).toBe(200);
  expect((await db.settings.findUniqueOrThrow({ where: { id: "main" } })).sessionMinutes).toBe(60);
});

test("POST refuses a duration that is not an offered preset", async () => {
  await db.settings.create({ data: { id: "main", passwordHash: "h", passwordSalt: "s" } });
  const { POST } = await import("@/app/api/admin/session/route");
  // 0 would lock the operator out; a typo must not be accepted.
  expect((await POST(await sessionReq("POST", { sessionMinutes: 0 }))).status).toBe(400);
  expect((await POST(await sessionReq("POST", { sessionMinutes: 7 }))).status).toBe(400);
});

test("the session routes are auth-guarded", async () => {
  const { GET, POST } = await import("@/app/api/admin/session/route");
  const noCookie = (method: string, body?: unknown) =>
    new NextRequest("http://localhost/api/admin/session", {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  expect((await GET(noCookie("GET"))).status).toBe(401);
  expect((await POST(noCookie("POST", { sessionMinutes: 15 }))).status).toBe(401);
});
