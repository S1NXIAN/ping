// The single-password auth and the absolute session. These are the only
// things standing between a stranger and every monitor, so the failure
// directions matter: a wrong password must fail, a session before expiry
// must authenticate, and one after it must not.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { NextRequest } from "next/server";
import { db, resetDb } from "./helpers/test-db";
import {
  createSession,
  getSessionMinutes,
  hashPassword,
  requireAuth,
  SESSION_COOKIE,
  SESSION_DEFAULT_MINUTES,
  SESSION_PRESETS,
  verifyPassword,
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

test("the configured duration is what the created session carries", async () => {
  await db.settings.create({
    data: { id: "main", passwordHash: "h", passwordSalt: "s", sessionMinutes: 30 },
  });
  const before = Date.now();
  const { expiresAt } = await createSession();
  // 30 minutes (± a few seconds of test runtime), not the 15-minute default.
  const minutes = (expiresAt.getTime() - before) / 60_000;
  expect(minutes).toBeGreaterThan(29);
  expect(minutes).toBeLessThan(31);
});

function reqWith(token: string): NextRequest {
  return new NextRequest("http://localhost/api/overview", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

test("a session before expiry authenticates", async () => {
  const { token, expiresAt } = await createSession();
  expect(await requireAuth(reqWith(token))).toBe(true);
  // …and still does just before the deadline.
  setSystemTime(new Date(expiresAt.getTime() - 1000));
  expect(await requireAuth(reqWith(token))).toBe(true);
});

test("a session after expiry does not authenticate", async () => {
  const { token, expiresAt } = await createSession();
  setSystemTime(new Date(expiresAt.getTime() + 1000));
  expect(await requireAuth(reqWith(token))).toBe(false);
});

test("a request with no session cookie is unauthenticated", async () => {
  const req = new NextRequest("http://localhost/api/overview");
  expect(await requireAuth(req)).toBe(false);
});
