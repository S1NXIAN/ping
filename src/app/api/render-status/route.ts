import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/ping-auth";
import { getRenderStatus } from "@/lib/render-status";

export async function GET(req: NextRequest) {
  const unauthorized = await guard(req);
  if (unauthorized) return unauthorized;

  const force = req.nextUrl.searchParams.get("force") === "1";
  const data = await getRenderStatus(force);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
