// PING single-password auth: scrypt-hashed password in the DB,
// opaque random session tokens, httpOnly cookies.
// Two clocks: a token proves identity until logout or a password change (it
// never expires), and the re-prompt window — counted from the last password
// entry — decides whether a fresh visit auto-enters or shows the login screen.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "./db";

export const SESSION_COOKIE = "ping_session";

/** Session-length presets (minutes) offered in Settings, and the default. */
export const SESSION_PRESETS = [5, 15, 30, 60, 120] as const;
export const SESSION_DEFAULT_MINUTES = 15;

/** Newest N sessions kept; older rows are pruned on login (tokens never
 *  expire, so nothing else would ever remove them). */
export const MAX_SESSIONS = 20;

/** The configured re-prompt window in minutes (default 15). */
export async function getSessionMinutes(): Promise<number> {
  const s = await db.settings.findUnique({
    where: { id: "main" },
    select: { sessionMinutes: true },
  });
  const n = s?.sessionMinutes;
  return n != null && n > 0 ? n : SESSION_DEFAULT_MINUTES;
}

export async function getSettings() {
  return db.settings.findUnique({ where: { id: "main" } });
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function createSession() {
  const token = randomBytes(32).toString("hex");
  await db.session.create({ data: { token } });
  // Keep the table bounded: tokens never expire, so without this every login
  // would leave a permanent row. The new token is always kept.
  // shortcut: two logins within the same millisecond can prune each other's
  // fresh token; logins are human-paced on single-admin software, so upgrade
  // to a transaction only if PING ever serves concurrent admins.
  const keep = await db.session.findMany({
    where: { token: { not: token } },
    orderBy: { createdAt: "desc" },
    take: MAX_SESSIONS - 1,
    select: { token: true },
  });
  await db.session.deleteMany({
    where: { token: { notIn: [token, ...keep.map((s) => s.token)] } },
  });
  return { token };
}

/**
 * Whether the re-prompt window is still open: true while fewer than
 * `minutes` have passed since the last password entry (`createdAt`). A closed
 * window shows the login screen on the next visit; it never breaks a live tab.
 */
export function windowOpen(createdAt: Date, minutes: number): boolean {
  return Date.now() < createdAt.getTime() + minutes * 60_000;
}

/** Drops the session cookie. Long-lived (a year) so a revisit inside the
 *  re-prompt window auto-enters even after a browser restart — the window, not
 *  the cookie, is what re-prompts. */
export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === "production",
  });
}

/** The caller's session row, or null. Tokens do not expire. */
export async function sessionFor(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return db.session.findUnique({ where: { token } });
}

export async function requireAuth(req: NextRequest): Promise<boolean> {
  return (await sessionFor(req)) !== null;
}

/** Returns a 401 response when the caller is not authenticated, else null. */
export async function guard(req: NextRequest): Promise<NextResponse | null> {
  const ok = await requireAuth(req);
  if (ok) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// ---- naive in-memory login throttling (per IP, 5 min window) ----
const attempts = new Map<string, number[]>();
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 15;
/** Hard caps: the Map can never grow without bound, even under floods of
 *  spoofed XFF values (entries only get pruned when their IP returns). */
const MAX_TRACKED_IPS = 2048;

export function clientIp(req: NextRequest): string {
  // NOTE: trusts the proxy-supplied x-forwarded-for (Render sets it to the
  // real client). A chained/spoofed XFF can rotate throttle buckets — the
  // MAX_ATTEMPTS per bucket and the global cap bound the damage either way.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "local";
}

/** Drops IPs whose every attempt is expired — one cheap pass over the Map. */
function sweepExpired(now: number) {
  for (const [ip, list] of attempts) {
    // `every` is vacuously true on an empty list, so it already covers length 0.
    if (list.every((t) => now - t >= WINDOW_MS)) {
      attempts.delete(ip);
    }
  }
}

export function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, list);
  if (list.length >= MAX_ATTEMPTS) return true;
  return false;
}

export function recordAttempt(ip: string) {
  const now = Date.now();
  if (attempts.size >= MAX_TRACKED_IPS) {
    sweepExpired(now);
    // Still at the cap after sweeping (a genuine flood of live buckets):
    // reset rather than grow — throttling degrades, memory does not.
    if (attempts.size >= MAX_TRACKED_IPS) attempts.clear();
  }
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  attempts.set(ip, list);
}

export function clearAttempts(ip: string) {
  attempts.delete(ip);
}
