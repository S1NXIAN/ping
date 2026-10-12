// The single-password auth and the session's two clocks. A token proves
// identity until logout or a password change; the re-prompt window (counted
// from the last password entry) decides whether a fresh visit auto-enters.
// These are the only things standing between a stranger and every monitor, so
// the failure directions matter: a wrong password must fail, a valid token
// must authenticate, and a lapsed window must not.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import {
  createSession,
  getSessionMinutes,
  hashPassword,
  MAX_SESSIONS,
  requireAuth,
  SESSION_COOKIE,
  SESSION_DEFAULT_MINUTES,
  SESSION_PRESETS,
  verifyPassword,
  windowOpen,
} from "@/lib/ping-auth";
import { beforeEach } from "bun:test";

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  setSystemTime();
});

test("a correct password verifies and a wrong one does not", () => {
  const { hash, salt } = hashPassword("correct horse battery staple");
  expect(verifyPassword("correct horse battery staple", hash, salt)).toBe(true);
  expect(verifyPassword("wrong password", hash, salt)).toBe(false);
});

test("the same password hashed twice yields different hashes (random salt)", () => {
  const a = hashPassword("same");
  const b = hashPassword("same");
  expect(a.hash).not.toBe(b.hash);
  expect(a.salt).not.toBe(b.salt);
  // …but both still verify the password.
  expect(verifyPassword("same", a.hash, a.salt)).toBe(true);
  expect(verifyPassword("same", b.hash, b.salt)).toBe(true);
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
