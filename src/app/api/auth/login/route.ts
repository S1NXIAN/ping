import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  clearAttempts,
  clientIp,
  createSession,
  getSettings,
  recordAttempt,
  setSessionCookie,
  tooManyAttempts,
  verifyPassword,
} from "@/lib/ping-auth";

const schema = z.object({
  password: z.string().min(1, "Password is required").max(200),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { error: "Too many attempts — try again in a few minutes" },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    recordAttempt(ip);
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  const settings = await getSettings();
  if (!settings) {
    recordAttempt(ip);
    return NextResponse.json(
      { error: "PING is not set up yet — create a password first" },
      { status: 400 },
    );
  }

  // Only a FAILED attempt counts toward the throttle. Counting successes too
  // would let routine logins push the global ceiling to 50 and lock everyone
  // out — the ceiling exists to bound guessing, not to punish valid use.
  if (!(await verifyPassword(parsed.data.password, settings.passwordHash, settings.passwordSalt))) {
    recordAttempt(ip);
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const session = await createSession();
  clearAttempts(ip);
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, session.token);
  return res;
}
