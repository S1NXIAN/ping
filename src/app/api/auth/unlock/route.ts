import { NextRequest, NextResponse } from "next/server";
import {
  clientIp,
  clearAttempts,
  getSettings,
  guard,
  issueUnlockToken,
  recordAttempt,
  setUnlockCookie,
  tooManyAttempts,
  verifyPassword,
} from "@/lib/ping-auth";

/**
 * Second gate in front of Settings: verifies the dashboard password for an
 * already-signed-in session and hands back a short-lived, HMAC-signed unlock
 * cookie. The unlock expires after 15 minutes (or instantly via /api/auth/lock).
 */
export async function POST(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const settings = await getSettings();
  if (!settings) {
    return NextResponse.json({ error: "PING is not set up yet" }, { status: 400 });
  }

  const ip = clientIp(req);
  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { error: "Too many attempts — try again in a few minutes" },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json({ error: "Enter your password" }, { status: 400 });
  }

  if (!verifyPassword(password, settings.passwordHash, settings.passwordSalt)) {
    recordAttempt(ip);
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  clearAttempts(ip);
  const { token, expiresAt } = issueUnlockToken(settings.passwordHash);
  const res = NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });
  setUnlockCookie(res, token, expiresAt);
  return res;
}
