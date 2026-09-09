import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  clearAttempts,
  clientIp,
  createSession,
  getSettings,
  hashPassword,
  recordAttempt,
  setSessionCookie,
  tooManyAttempts,
} from "@/lib/ping-auth";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { error: "Too many attempts — try again in a few minutes" },
      { status: 429 },
    );
  }
  recordAttempt(ip);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const existing = await getSettings();
  if (existing) {
    return NextResponse.json(
      { error: "PING is already set up — use login instead" },
      { status: 400 },
    );
  }

  const { hash, salt } = hashPassword(parsed.data.password);
  await db.settings.create({ data: { id: "main", passwordHash: hash, passwordSalt: salt } });

  const session = await createSession();
  clearAttempts(ip);
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, session.token, session.expiresAt);
  return res;
}
