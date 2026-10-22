// The single-password auth and the session's two clocks. A token proves
// identity until logout or a password change; the re-prompt window (counted
// from the last password entry) decides whether a fresh visit auto-enters.
// These are the only things standing between a stranger and every monitor, so
// the failure directions matter: a wrong password must fail, a valid token
// must authenticate, and a lapsed window must not.
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import {
  clearAttempts,
  createSession,
  getSessionMinutes,
  hashPassword,
  LOCKOUT_MS,
  MAX_ATTEMPTS,
  MAX_GLOBAL_ATTEMPTS,
  MAX_SESSIONS,
  recordAttempt,
  requireAuth,
  resetThrottle,
  SESSION_COOKIE,
  SESSION_DEFAULT_MINUTES,
  SESSION_PRESETS,
  tooManyAttempts,
  verifyPassword,
  windowOpen,
} from "@/lib/ping-auth";

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  setSystemTime();
  resetThrottle(); // throttle state is process-global — never leak it across tests
});

test("a correct password verifies and a wrong one does not", async () => {
  const { hash, salt } = await hashPassword("correct horse battery staple");
  expect(await verifyPassword("correct horse battery staple", hash, salt)).toBe(true);
  expect(await verifyPassword("wrong password", hash, salt)).toBe(false);
});

test("the same password hashed twice yields different hashes (random salt)", async () => {
  const a = await hashPassword("same");
  const b = await hashPassword("same");
  expect(a.hash).not.toBe(b.hash);
  expect(a.salt).not.toBe(b.salt);
  // …but both still verify the password.
  expect(await verifyPassword("same", a.hash, a.salt)).toBe(true);
  expect(await verifyPassword("same", b.hash, b.salt)).toBe(true);
});

test("the session length defaults to 15 minutes when unset", async () => {
  await db.settings.create({
    data: { id: "main", passwordHash: "h", passwordSalt: "s" },
  });
  expect(await getSessionMinutes()).toBe(SESSION_DEFAULT_MINUTES);
  expect(SESSION_DEFAULT_MINUTES).toBe(15);
});

test("the offered durations are exactly 5/15/30/60/120 minutes", () => {
  expect([...SESSION_PRESETS]).toEqual([5, 15, 30, 60, 120]);
});

function reqWith(token: string): NextRequest {
  return new NextRequest("http://localhost/api/overview", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

test("a session's token authenticates", async () => {
  const { token } = await createSession();
  expect(await requireAuth(reqWith(token))).toBe(true);
});

test("a session's token still authenticates a year later (no expiry)", async () => {
  const { token } = await createSession();
  // The token never expires: the re-prompt window is a separate concern.
  setSystemTime(new Date(Date.now() + 365 * 86_400_000));
  expect(await requireAuth(reqWith(token))).toBe(true);
});

test("a request with no session cookie is unauthenticated", async () => {
  const req = new NextRequest("http://localhost/api/overview");
  expect(await requireAuth(req)).toBe(false);
});

test("the re-prompt window is open right after login", async () => {
  const { token } = await createSession();
  const session = await db.session.findUniqueOrThrow({ where: { token } });
  expect(windowOpen(session.createdAt, 15)).toBe(true);
});

test("the re-prompt window is still open one second before the length", async () => {
  const { token } = await createSession();
  const session = await db.session.findUniqueOrThrow({ where: { token } });
  setSystemTime(new Date(session.createdAt.getTime() + 15 * 60_000 - 1000));
  expect(windowOpen(session.createdAt, 15)).toBe(true);
});

test("the re-prompt window closes once the session length has passed", async () => {
  const { token } = await createSession();
  const session = await db.session.findUniqueOrThrow({ where: { token } });
  setSystemTime(new Date(session.createdAt.getTime() + 15 * 60_000 + 1000));
  expect(windowOpen(session.createdAt, 15)).toBe(false);
});

test("logins cap the stored sessions at the newest 20", async () => {
  // Real logins are human-paced, so advance the clock to keep createdAt
  // strictly increasing (same-millisecond ties are the only ambiguous case).
  const base = Date.now();
  for (let i = 0; i < MAX_SESSIONS + 5; i++) {
    setSystemTime(new Date(base + i * 1000));
    await createSession();
  }
  expect(await db.session.count()).toBe(MAX_SESSIONS);
});

// ---- login throttling ----
// The password is the only thing in front of every monitor, so the throttle
// must actually bound guesses. A per-IP bucket alone is defeated by rotating
// the x-forwarded-for header (the caller controls it), so a process-wide
// ceiling backs it up.
test("one IP is refused after MAX_ATTEMPTS attempts in the window", () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    expect(tooManyAttempts("1.2.3.4")).toBe(false);
    recordAttempt("1.2.3.4");
  }
  expect(tooManyAttempts("1.2.3.4")).toBe(true);
});

test("the third failure starts a full LOCKOUT_MS cooldown", () => {
  const start = Date.now();
  setSystemTime(new Date(start));
  recordAttempt("2.3.4.5");
  setSystemTime(new Date(start + 60_000));
  recordAttempt("2.3.4.5");
  setSystemTime(new Date(start + 120_000));
  recordAttempt("2.3.4.5"); // crosses the limit here
  expect(tooManyAttempts("2.3.4.5")).toBe(true);
  // Still locked one millisecond before the cooldown ends…
  setSystemTime(new Date(start + 120_000 + LOCKOUT_MS - 1));
  expect(tooManyAttempts("2.3.4.5")).toBe(true);
  // …and open again at the boundary.
  setSystemTime(new Date(start + 120_000 + LOCKOUT_MS));
  expect(tooManyAttempts("2.3.4.5")).toBe(false);
});

test("failures older than the window do not count toward the limit", () => {
  const start = Date.now();
  setSystemTime(new Date(start));
  recordAttempt("6.7.8.9");
  setSystemTime(new Date(start + 61_000));
  recordAttempt("6.7.8.9");
  // The first failure is now older than the window, so the next one is only
  // the second live failure — no lockout.
  setSystemTime(new Date(start + 181_000));
  recordAttempt("6.7.8.9");
  expect(tooManyAttempts("6.7.8.9")).toBe(false);
});

test("a successful login clears the failure run for the IP", () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) recordAttempt("7.8.9.10");
  expect(tooManyAttempts("7.8.9.10")).toBe(true);
  clearAttempts("7.8.9.10");
  expect(tooManyAttempts("7.8.9.10")).toBe(false);
});

test("rotating the source IP cannot mint unlimited attempts (global ceiling)", () => {
  // Each IP stays under its own per-IP cap, but the fleet-wide total is bounded.
  for (let i = 0; i < MAX_GLOBAL_ATTEMPTS; i++) {
    const ip = `10.0.0.${i}`;
    expect(tooManyAttempts(ip)).toBe(false);
    recordAttempt(ip);
  }
  // A brand-new IP — never seen before — is still refused.
  expect(tooManyAttempts("10.0.0.250")).toBe(true);
});

// ---- POST /api/auth/login (the route itself, not just the throttle helpers) ----

test("login with the right password sets a session cookie; a wrong one does not", async () => {
  const { hash, salt } = await hashPassword("correctpassword");
  await db.settings.create({ data: { id: "main", passwordHash: hash, passwordSalt: salt } });
  const { POST } = await import("@/app/api/auth/login/route");

  const ok = await POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correctpassword" }),
    }),
  );
  expect(ok.status).toBe(200);
  const cookie = ok.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(SESSION_COOKIE);
  expect(await db.session.count()).toBe(1);

  const bad = await POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrongpassword" }),
    }),
  );
  expect(bad.status).toBe(401);
  expect(await db.session.count()).toBe(1); // no new session issued
});

test("the login route refuses the fourth attempt with 429 and Retry-After", async () => {
  setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const { hash, salt } = await hashPassword("correctpassword");
  await db.settings.create({ data: { id: "main", passwordHash: hash, passwordSalt: salt } });
  const { POST } = await import("@/app/api/auth/login/route");

  const attempt = () =>
    POST(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "wrongpassword" }),
      }),
    );

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    expect((await attempt()).status).toBe(401);
  }
  const blocked = await attempt();
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("retry-after")).toBe(String(LOCKOUT_MS / 1000));
  expect((await blocked.json()).error).toBe("Too many attempts — try again in 3 minutes");
});

test("a successful login does not count toward the global throttle ceiling", async () => {
  const { hash, salt } = await hashPassword("correctpassword");
  await db.settings.create({ data: { id: "main", passwordHash: hash, passwordSalt: salt } });

  // Fill the global bucket to one below the ceiling (no hashing — the throttle
  // helpers are cheap), then log in once. If the successful login counted, the
  // bucket would reach the ceiling and refuse a brand-new IP.
  for (let i = 0; i < MAX_GLOBAL_ATTEMPTS - 1; i++) recordAttempt(`filler-${i}`);
  expect(tooManyAttempts("fresh-ip")).toBe(false);

  const { POST } = await import("@/app/api/auth/login/route");
  const res = await POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correctpassword" }),
    }),
  );
  expect(res.status).toBe(200);
  // The bucket is still one below the ceiling — the success added nothing.
  expect(tooManyAttempts("another-fresh-ip")).toBe(false);
});
