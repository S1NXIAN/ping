import { NextRequest, NextResponse } from "next/server";
import { getSettings, requireAuth, verifyUnlockToken } from "@/lib/ping-auth";

export async function GET(req: NextRequest) {
  const settings = await getSettings();
  const authenticated = settings ? await requireAuth(req) : false;

  // Admin unlock state: true only with a valid session AND a valid,
  // unexpired unlock cookie. Reported so the client knows whether the
  // Settings button opens directly or prompts for the password.
  let adminUnlocked = false;
  let unlockExpiresAt: string | null = null;
  if (settings && authenticated) {
    const expiry = verifyUnlockToken(
      req.cookies.get("ping_unlock")?.value,
      settings.passwordHash,
    );
    if (expiry) {
      adminUnlocked = true;
      unlockExpiresAt = expiry.toISOString();
    }
  }

  return NextResponse.json(
    { initialized: settings !== null, authenticated, adminUnlocked, unlockExpiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
