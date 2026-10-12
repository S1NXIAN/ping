import { NextRequest, NextResponse } from "next/server";
import { getSettings, sessionFor } from "@/lib/ping-auth";
import { captureSelfMonitorOrigin, requestOrigin } from "@/lib/self-monitor";

export async function GET(req: NextRequest) {
  const settings = await getSettings();
  const session = settings ? await sessionFor(req) : null;

  // Lazy Self-monitor capture: the first authenticated request carries this
  // deployment's host, which is where the Self-monitor should point when the
  // platform env var is absent. Best-effort — never fails the session check.
  if (session) {
    await captureSelfMonitorOrigin(requestOrigin(req)).catch(() => undefined);
  }

  return NextResponse.json(
    {
      initialized: settings !== null,
      authenticated: session !== null,
      expiresAt: session?.expiresAt.toISOString() ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
