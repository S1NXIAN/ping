// PING single-password auth: scrypt-hashed password in the DB,
// opaque random session tokens, httpOnly cookies.
// Two clocks: a token proves identity until logout or a password change (it
// never expires), and the re-prompt window — counted from the last password
// entry — decides whether a fresh visit auto-enters or shows the login screen.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "./db";

// Async scrypt (thread-pool), not scryptSync: the sync form freezes the event
// loop for the whole hash (~65 ms), stalling every other request during a
// login. The derived bytes are identical, so stored hashes keep verifying.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

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

export async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = (await scryptAsync(password, salt, 64)).toString("hex");
  return { hash, salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const candidate = await scryptAsync(password, salt, 64);
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

// ---- in-memory login throttling (per IP + a global ceiling) ----
// Two buckets, because the per-IP one is keyed on a caller-supplied header
// (x-forwarded-for). An attacker rotating that header gets a fresh per-IP
// bucket each request, so the per-IP cap alone would never fire — the global
// ceiling is what actually bounds guesses. It fails closed: once the ceiling
// is reached, every caller is refused for the cooldown, so one attacker can
// briefly lock the admin out too. That is the intended trade (bounding
// guesses beats staying reachable), not a fairness guarantee.
//
// Policy: MAX_ATTEMPTS failures inside WINDOW_MS lock the bucket for
// LOCKOUT_MS, counted from the failure that crossed the limit — not from the
// first one — so the wait is always the full cooldown.
//
// Held on `globalThis`, not in module scope: Next compiles /api/auth/login and
// /api/auth/setup into separate server bundles, so a module-level Map would be
// one copy per bundle and a guess spent against one route would not count
// against the other. Same pattern as the checker's in-flight guard.
interface ThrottleBucket {
  /** Failure timestamps in the current run, pruned to WINDOW_MS. */
  failures: number[];
  /** Epoch ms until which this bucket refuses attempts; 0 = open. */
  blockedUntil: number;
}
interface ThrottleState {
  attempts: Map<string, ThrottleBucket>;
  global: ThrottleBucket;
}
const emptyBucket = (): ThrottleBucket => ({ failures: [], blockedUntil: 0 });
const throttleState = (): ThrottleState => {
  // V2: the previous shape used timestamp arrays, and a dev server can carry
  // the old object across a hot reload — a fresh key avoids reading that shape.
  const g = globalThis as unknown as { __pingThrottleV2?: ThrottleState };
  return (g.__pingThrottleV2 ??= { attempts: new Map(), global: emptyBucket() });
};
const WINDOW_MS = 3 * 60_000;
export const MAX_ATTEMPTS = 3;
export const LOCKOUT_MS = 3 * 60_000;
/** Attempts per window across ALL IPs — the rotating-header backstop. */
export const MAX_GLOBAL_ATTEMPTS = 3;
/** Hard caps: the Map can never grow without bound, even under floods of
 *  spoofed XFF values (entries only get pruned when their IP returns). */
const MAX_TRACKED_IPS = 2048;

export function clientIp(req: NextRequest): string {
  // NOTE: trusts the proxy-supplied x-forwarded-for (Render sets it to the
  // real client). A chained/spoofed XFF can rotate throttle buckets — the
  // MAX_ATTEMPTS per bucket and the global ceiling bound the damage either way.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "local";
}

/** Drops IPs with no live failures and no active lockout — one pass over the Map. */
function sweepExpired(now: number) {
  const { attempts } = throttleState();
  for (const [ip, bucket] of attempts) {
    if (bucket.blockedUntil > now) continue;
    if (bucket.blockedUntil !== 0) bucket.blockedUntil = 0;
    bucket.failures = bucket.failures.filter((t) => now - t < WINDOW_MS);
    if (bucket.failures.length === 0) attempts.delete(ip);
  }
}

/** True while a bucket is locked; clears it once the cooldown has elapsed. */
function bucketBlocked(bucket: ThrottleBucket, now: number): boolean {
  if (bucket.blockedUntil === 0) return false;
  if (now < bucket.blockedUntil) return true;
  bucket.blockedUntil = 0;
  bucket.failures = [];
  return false;
}

export function tooManyAttempts(ip: string): boolean {
  const { attempts, global } = throttleState();
  const now = Date.now();
  if (bucketBlocked(global, now)) return true;
  const bucket = attempts.get(ip);
  return bucket ? bucketBlocked(bucket, now) : false;
}

/** Records one failed attempt; locks the bucket when `limit` is crossed. */
function recordFailure(bucket: ThrottleBucket, now: number, limit: number) {
  if (bucket.blockedUntil !== 0) {
    if (now < bucket.blockedUntil) return; // already locked — don't extend it
    bucket.blockedUntil = 0;
    bucket.failures = [];
  }
  bucket.failures = bucket.failures.filter((t) => now - t < WINDOW_MS);
  bucket.failures.push(now);
  if (bucket.failures.length >= limit) {
    bucket.blockedUntil = now + LOCKOUT_MS;
    bucket.failures = [];
  }
}

export function recordAttempt(ip: string) {
  const state = throttleState();
  const now = Date.now();
  recordFailure(state.global, now, MAX_GLOBAL_ATTEMPTS);
  if (state.attempts.size >= MAX_TRACKED_IPS) {
    sweepExpired(now);
    // Still at the cap after sweeping (a genuine flood of live buckets):
    // reset rather than grow — throttling degrades, memory does not.
    if (state.attempts.size >= MAX_TRACKED_IPS) state.attempts.clear();
  }
  const bucket = state.attempts.get(ip) ?? emptyBucket();
  recordFailure(bucket, now, MAX_ATTEMPTS);
  state.attempts.set(ip, bucket);
}

/** Remaining cooldown for this caller (or the global ceiling), in ms. */
export function retryAfterMs(ip: string): number {
  const { attempts, global } = throttleState();
  const now = Date.now();
  const until = Math.max(global.blockedUntil, attempts.get(ip)?.blockedUntil ?? 0);
  return until > now ? until - now : 0;
}

/** Returns a 429 response when this caller (or the global ceiling) is locked, else null. */
export function throttleResponse(ip: string): NextResponse | null {
  if (!tooManyAttempts(ip)) return null;
  const retrySec = Math.ceil(retryAfterMs(ip) / 1000);
  const minutes = Math.max(1, Math.ceil(retrySec / 60));
  return NextResponse.json(
    { error: `Too many attempts — try again in ${minutes} minute${minutes === 1 ? "" : "s"}` },
    { status: 429, headers: { "retry-after": String(retrySec) } },
  );
}

export function clearAttempts(ip: string) {
  const state = throttleState();
  state.attempts.delete(ip);
  // A successful login ends the failure run. Leaving earlier failures behind
  // would make the next typo the one that crosses a 3-attempt ceiling.
  state.global = emptyBucket();
}

/** Test seam: drops all throttle state so tests do not leak into each other. */
export function resetThrottle() {
  const state = throttleState();
  state.attempts.clear();
  state.global = emptyBucket();
}
