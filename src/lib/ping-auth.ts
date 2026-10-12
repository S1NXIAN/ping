// PING single-password auth: scrypt-hashed password in the DB,
// opaque random session tokens, httpOnly cookies.
// One gate: a dashboard Session with an ABSOLUTE expiry counted from login
// (no sliding, no idle detection). Duration is an admin setting.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "./db";

export const SESSION_COOKIE = "ping_session";

/** Session-length presets (minutes) offered in Settings, and the default. */
export const SESSION_PRESETS = [5, 15, 30, 60, 120] as const;
export const SESSION_DEFAULT_MINUTES = 15;

/** The configured absolute session length in minutes (default 15). */
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
  const minutes = await getSessionMinutes();
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  await db.session.create({ data: { token, expiresAt } });
  return { token, expiresAt };
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    secure: process.env.NODE_ENV === "production",
  });
}

/** The caller's unexpired session row, or null. Expired rows are dropped. */
export async function sessionFor(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { token } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { token } }).catch(() => undefined);
    return null;
  }
  return session;
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
