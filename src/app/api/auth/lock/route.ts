import { NextRequest, NextResponse } from "next/server";
import { clearUnlockCookie, guard } from "@/lib/ping-auth";

/** Manually re-locks Settings: clears the admin unlock cookie immediately. */
export async function POST(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const res = NextResponse.json({ ok: true });
  clearUnlockCookie(res);
  return res;
}
