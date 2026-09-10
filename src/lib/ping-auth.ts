// PING single-password auth: scrypt-hashed password in the DB,
// opaque random session tokens, httpOnly cookies.
// On top of the session sits an "admin unlock" — a short-lived, HMAC-signed
// cookie required by the settings/admin APIs so the Settings area stays
// password-protected even while a dashboard session is active.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "./db";

export const SESSION_COOKIE = "ping_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const UNLOCK_COOKIE = "ping_unlock";
export const UNLOCK_TTL_MS = 15 * 60_000; // settings stay unlocked for 15 minutes

/** Stable error message the frontend can match to re-prompt for the password. */
export const ADMIN_LOCKED_MSG = "Admin locked — unlock Settings with your password";

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
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
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

export async function requireAuth(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const session = await db.session.findUnique({ where: { token } });
  if (!session) return false;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { token } }).catch(() => undefined);
    return false;
  }
  return true;
}

/** Returns a 401 response when the caller is not authenticated, else null. */
export async function guard(req: NextRequest): Promise<NextResponse | null> {
  const ok = await requireAuth(req);
  if (ok) return null;
  const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return res;
}

// ---- admin unlock (second gate in front of Settings) ----

// The HMAC key is derived from the current password hash, so every
// outstanding unlock token dies automatically when the password changes.
function unlockKey(passwordHash: string): Buffer {
  return createHmac("sha256", "ping-unlock-v1").update(passwordHash).digest();
}

export function issueUnlockToken(
  passwordHash: string,
): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + UNLOCK_TTL_MS);
  const exp = String(expiresAt.getTime());
  const sig = createHmac("sha256", unlockKey(passwordHash)).update(exp).digest("hex");
  return { token: `${exp}.${sig}`, expiresAt };
}

/** Validates an unlock cookie; returns its expiry when valid, else null. */
export function verifyUnlockToken(
  token: string | undefined,
  passwordHash: string,
): Date | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || !Number.isInteger(expMs) || expMs <= Date.now()) return null;
  const expected = createHmac("sha256", unlockKey(passwordHash)).update(exp).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return new Date(expMs);
}

export function setUnlockCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(UNLOCK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearUnlockCookie(res: NextResponse) {
  res.cookies.set(UNLOCK_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
}

/** Reads + verifies the unlock cookie for an authenticated request. */
export async function getUnlockExpiry(
  req: NextRequest,
  passwordHash: string,
): Promise<Date | null> {
  return verifyUnlockToken(req.cookies.get(UNLOCK_COOKIE)?.value, passwordHash);
}

/**
 * Guard for the settings/admin APIs: requires BOTH a valid session and a
 * valid (unexpired) admin unlock. Returns a 401 response when either is
 * missing, else null. The "Admin locked" message tells the client to prompt
 * for the password again rather than sign the user out.
 */
export async function adminGuard(req: NextRequest): Promise<NextResponse | null> {
  const settings = await getSettings();
  if (!settings) {
    return NextResponse.json({ error: "PING is not set up yet" }, { status: 400 });
  }
  const authed = await requireAuth(req);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const expiry = verifyUnlockToken(req.cookies.get(UNLOCK_COOKIE)?.value, settings.passwordHash);
  if (!expiry) {
    return NextResponse.json({ error: ADMIN_LOCKED_MSG }, { status: 401 });
  }
  return null;
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
    if (list.length === 0 || list.every((t) => now - t >= WINDOW_MS)) {
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
