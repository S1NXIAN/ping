import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  adminGuard,
  createSession,
  getSettings,
  hashPassword,
  issueUnlockToken,
  setSessionCookie,
  setUnlockCookie,
  verifyPassword,
} from "@/lib/ping-auth";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters").max(200),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must be different from the current one",
    path: ["newPassword"],
  });

export async function POST(req: NextRequest) {
  const unauthorized = await adminGuard(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const settings = await getSettings();
  if (!settings) {
    return NextResponse.json({ error: "PING is not set up yet" }, { status: 400 });
  }
  if (!verifyPassword(parsed.data.currentPassword, settings.passwordHash, settings.passwordSalt)) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const { hash, salt } = hashPassword(parsed.data.newPassword);
  await db.settings.update({
    where: { id: "main" },
    data: { passwordHash: hash, passwordSalt: salt },
  });

  // Revoke every existing session, then issue a fresh one to stay signed in.
  await db.session.deleteMany({});
  const session = await createSession();

  // The unlock HMAC is keyed to the password hash, so old unlock cookies are
  // now dead by construction. The user just proved the new password, so hand
  // them a fresh 15-minute unlock to stay in Settings without friction.
  const unlock = issueUnlockToken(hash);

  const res = NextResponse.json({ ok: true, unlockExpiresAt: unlock.expiresAt.toISOString() });
  setSessionCookie(res, session.token, session.expiresAt);
  setUnlockCookie(res, unlock.token, unlock.expiresAt);
  return res;
}
