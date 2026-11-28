import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/ping-auth";
import { listIncidents } from "@/lib/incidents";

/** Lists the last 30 days of derived incidents for one Scope. Session
 *  required. An optional `folderId` narrows the list to that Folder's monitors
 *  — scoping happens BEFORE the cap, so a Folder's incidents are never dropped
 *  for another's. */
export async function GET(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const incidents = await listIncidents({
    folderId: req.nextUrl.searchParams.get("folderId") ?? undefined,
  });
  return NextResponse.json(
    { incidents },
    { headers: { "Cache-Control": "no-store" } },
  );
}
