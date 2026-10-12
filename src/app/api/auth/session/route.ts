import { NextRequest, NextResponse } from "next/server";
import { getSettings, sessionFor } from "@/lib/ping-auth";

export async function GET(req: NextRequest) {
  const settings = await getSettings();
  const session = settings ? await sessionFor(req) : null;

  return NextResponse.json(
    {
      initialized: settings !== null,
      authenticated: session !== null,
      expiresAt: session?.expiresAt.toISOString() ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
